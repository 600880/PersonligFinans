using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PersonligFinans.Api.BankStatements;
using PersonligFinans.Api.Bookmarks;
using PersonligFinans.Api.Categories;
using PersonligFinans.Api.CategorizationRules;
using PersonligFinans.Api.Data;
using PersonligFinans.Api.Folders;
using PersonligFinans.Api.Transactions;
using PersonligFinans.Api.Users;
using UglyToad.PdfPig.Content;
using UglyToad.PdfPig.Core;
using UglyToad.PdfPig.Fonts.Standard14Fonts;
using UglyToad.PdfPig.Writer;

namespace PersonligFinans.Api.Tests;

[Collection(ApiCollection.Name)]
public class BankStatementEndpointsTests : IAsyncLifetime
{
    private readonly PostgresApiFactory _factory;
    private readonly string _email = SignedInClient.UniqueEmail();
    private HttpClient _client = null!;
    private TestCategories _categories = null!;

    public BankStatementEndpointsTests(PostgresApiFactory factory)
    {
        _factory = factory;
    }

    public async Task InitializeAsync()
    {
        _client = await _factory.CreateSignedInClientAsync(_email);
        _categories = await TestCategories.Of(_client);
    }

    public Task DisposeAsync() => Task.CompletedTask;

    // Uploads to the API as configured by default, with no rule generator.
    private Task<HttpResponseMessage> Upload(byte[] pdf) => Upload(pdf, _client);

    // Uploads to an API that has the given rule generator, as part of the given Upload, or as an
    // Upload of its own.
    private async Task<HttpResponseMessage> Upload(byte[] pdf, IRuleGenerator ruleGenerator, string? uploadId = null)
    {
        await using var api = _factory.WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services => services.AddSingleton(ruleGenerator)));
        using var client = await api.CreateClientSignedInAsAsync(_email);
        return await Upload(pdf, client, uploadId);
    }

    private static async Task<HttpResponseMessage> Upload(byte[] pdf, HttpClient client, string? uploadId = null)
    {
        var file = new ByteArrayContent(pdf);
        file.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
        using var form = new MultipartFormDataContent { { file, "file", "kontoutskrift.pdf" } };
        if (uploadId is not null)
            form.Add(new StringContent(uploadId), "uploadId");
        return await client.PostAsync("/api/bank-statements", form);
    }

    [Fact]
    public async Task Post_OnePageStatement_StoresTransactionsLinkedToStatement()
    {
        var pdf = StatementPdf.Create(
            accountNumber: "1111.22.33333",
            period: "01.08.2026 - 31.08.2026",
            openingBalance: "1.000,00",
            rows:
            [
                new("Til: Strømselskap AS Betalt: 01.08.26", "0308", "5.356,00", null, "0308", "10000000001", "100000002"),
                new("*1111 31.07 Nok 296.60 Matbutikk Sentrum Kurs: 1.0000", "0308", "296,60", null, "0308", "21", "12345678"),
                new("*1111 03.08 Nok 50.00 Rema 1000", "0408", "50,00", null, "0408", "21", "12345678"),
                new("Overføring mellom egne kontoer", "1308", null, "22.000,00", "1308", "100003", "100000002"),
                new("Lønn Fra: Testfirma AS", "1908", null, "24.500,00", "1908", "100000004", "100000005"),
            ],
            closingBalance: "41.797,40");

        var response = await Upload(pdf);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<BankStatementResponse>();
        Assert.Equal("1111.22.33333", created!.AccountNumber);
        Assert.Equal(new DateOnly(2026, 8, 1), created.PeriodStart);
        Assert.Equal(new DateOnly(2026, 8, 31), created.PeriodEnd);
        Assert.Equal(5, created.TransactionCount);

        await using var user = await UserDatabase.OfAsync(_factory, _email);
        var db = user.Db;
        var stored = await db.Transactions
            .Where(t => t.BankStatementId == created.Id)
            .OrderBy(t => t.Id)
            .ToListAsync();
        Assert.Equal(
            [
                (new DateOnly(2026, 8, 3), "Strømselskap AS", -5356.00m),
                (new DateOnly(2026, 8, 3), "Matbutikk Sentrum", -296.60m),
                (new DateOnly(2026, 8, 4), "Rema 1000", -50.00m),
                (new DateOnly(2026, 8, 13), "Overføring mellom egne kontoer", 22000.00m),
                (new DateOnly(2026, 8, 19), "Lønn Fra: Testfirma AS", 24500.00m),
            ],
            stored.Select(t => (t.PostedDate, t.Description, t.Amount)));
        // Seeded rules categorize the merchants they know; the rest stay Uncategorized.
        Assert.Equal([null, null, _categories.Groceries, _categories.Savings, null], stored.Select(t => t.CategoryId));
        Assert.All(stored, t => Assert.Null(t.Note));
    }

    [Fact]
    public async Task Post_TwoPageStatementWithWrappedRow_ImportsRowsFromBothPages()
    {
        var pdf = StatementPdf.Create(
            accountNumber: "6666.77.88888",
            period: "01.08.2026 - 31.08.2026",
            openingBalance: "1.000,00",
            pages:
            [
                new(
                    [
                        new("Til: Strømselskap AS Betalt: 01.08.26", "0308", "5.356,00", null, "0308", "10000000001", "100000002"),
                        new("*1111 31.07 Nok 296.60 Matbutikk Sentrum Kurs:", "0308", "296,60", null, "0308", "21", "12345678",
                            Continuation: "1.0000"),
                        new("Overføring mellom egne kontoer", "1308", null, "22.000,00", "1308", "100003", "100000002"),
                    ],
                    CarriedBalance: "17.347,40"),
                new(
                    [
                        new("Lønn Fra: Testfirma AS", "1908", null, "24.500,00", "1908", "100000004", "100000005"),
                        new("Varer 28.08 Matbutikk Sentrum", "2908", "1.234,50", null, "2908", "21", "12345678"),
                    ]),
            ],
            closingBalance: "40.612,90");

        var response = await Upload(pdf);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<BankStatementResponse>();
        Assert.Equal(5, created!.TransactionCount);

        await using var user = await UserDatabase.OfAsync(_factory, _email);
        var db = user.Db;
        var stored = await db.Transactions
            .Where(t => t.BankStatementId == created.Id)
            .OrderBy(t => t.Id)
            .ToListAsync();
        Assert.Equal(
            [
                (new DateOnly(2026, 8, 3), "Strømselskap AS", -5356.00m),
                (new DateOnly(2026, 8, 3), "Matbutikk Sentrum", -296.60m),
                (new DateOnly(2026, 8, 13), "Overføring mellom egne kontoer", 22000.00m),
                (new DateOnly(2026, 8, 19), "Lønn Fra: Testfirma AS", 24500.00m),
                (new DateOnly(2026, 8, 29), "Matbutikk Sentrum", -1234.50m),
            ],
            stored.Select(t => (t.PostedDate, t.Description, t.Amount)));
    }

    // A small statement that reconciles: 100,00 − 25,00 + 50,00 = 125,00.
    private static byte[] ReconcilingStatement(string accountNumber, string closingBalance = "125,00") =>
        StatementPdf.Create(
            accountNumber,
            period: "01.08.2026 - 31.08.2026",
            openingBalance: "100,00",
            rows:
            [
                new("*1111 03.08 Nok 25.00 Rema 1000", "0408", "25,00", null, "0408", "21", "12345678"),
                new("Overføring mellom egne kontoer", "1308", null, "50,00", "1308", "100003", "100000002"),
            ],
            closingBalance);

    private async Task<(int Statements, int Transactions)> StoredFor(string accountNumber)
    {
        await using var user = await UserDatabase.OfAsync(_factory, _email);
        var db = user.Db;
        var statements = await db.BankStatements.CountAsync(s => s.AccountNumber == accountNumber);
        var transactions = await db.Transactions.CountAsync(t => t.BankStatement!.AccountNumber == accountNumber);
        return (statements, transactions);
    }

    private static async Task<string[]> FileErrors(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        return problem!.Errors["file"];
    }

    private static byte[] PdfWithText(string text)
    {
        var builder = new PdfDocumentBuilder();
        var font = builder.AddStandard14Font(Standard14Font.Helvetica);
        builder.AddPage(PageSize.A4).AddText(text, 12, new PdfPoint(40, 800), font);
        return builder.Build();
    }

    private async Task<HttpResponseMessage> UploadFile(byte[] content, string fileName, string contentType)
    {
        var file = new ByteArrayContent(content);
        file.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        using var form = new MultipartFormDataContent { { file, "file", fileName } };
        return await _client.PostAsync("/api/bank-statements", form);
    }

    [Fact]
    public async Task Post_SameStatementTwice_ReturnsConflictAndAddsNoRows()
    {
        var pdf = ReconcilingStatement("2222.33.44444");
        Assert.Equal(HttpStatusCode.Created, (await Upload(pdf)).StatusCode);

        var response = await Upload(pdf);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ProblemDetails>();
        Assert.Equal(
            "Statement for 2222.33.44444, 01.08.2026–31.08.2026 has already been imported.",
            problem!.Detail);
        Assert.Equal((1, 2), await StoredFor("2222.33.44444"));
    }

    [Fact]
    public async Task Post_SamePeriodForAnotherAccount_IsAccepted()
    {
        Assert.Equal(HttpStatusCode.Created, (await Upload(ReconcilingStatement("3333.44.55555"))).StatusCode);

        var response = await Upload(ReconcilingStatement("3333.44.55556"));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal((1, 2), await StoredFor("3333.44.55556"));
    }

    [Fact]
    public async Task Post_StatementThatDoesNotReconcile_IsRejectedAndNothingStored()
    {
        var response = await Upload(ReconcilingStatement("4444.55.66666", closingBalance: "130,00"));

        Assert.Equal(
            ["The statement's transactions don't add up: expected a closing balance of 125,00 but the statement says 130,00."],
            await FileErrors(response));
        Assert.Equal((0, 0), await StoredFor("4444.55.66666"));
    }

    [Fact]
    public async Task Post_StatementWithUnreadableRow_IsRejectedAndNothingStored()
    {
        var pdf = StatementPdf.Create(
            accountNumber: "5555.66.77777",
            period: "01.08.2026 - 31.08.2026",
            openingBalance: "1.000,00",
            rows:
            [
                new("*1111 03.08 Nok 250.00 Rema 1000", "0408", "250,00", null, "0408", "21", "12345678"),
                new("Varer 32.08 Ukjent butikk", "3208", "100,00", null, "3208", "21", "12345678"),
            ],
            closingBalance: "650,00");

        var response = await Upload(pdf);

        Assert.Equal(["Could not read the statement line \"Varer 32.08 Ukjent butikk\"."], await FileErrors(response));
        Assert.Equal((0, 0), await StoredFor("5555.66.77777"));
    }

    [Fact]
    public async Task Post_PdfThatIsNotABankStatement_IsRejected()
    {
        var response = await Upload(PdfWithText("Faktura 42 fra Snekker AS"));

        Assert.Equal(["The file is not a Sparebanken Norge Bank Statement."], await FileErrors(response));
    }

    [Fact]
    public async Task Post_FileThatIsNotAPdf_IsRejected()
    {
        var response = await UploadFile("Dato;Beløp\n03.08.2026;-250,00"u8.ToArray(), "kontoutskrift.csv", "text/csv");

        Assert.Equal(["The file is not a PDF."], await FileErrors(response));
    }

    [Fact]
    public async Task Post_DamagedPdf_IsRejected()
    {
        var response = await Upload("%PDF-1.7\nthis is not really a PDF"u8.ToArray());

        Assert.Equal(["The PDF could not be read. It may be damaged."], await FileErrors(response));
    }

    [Fact]
    public async Task Post_FileOverTenMegabytes_IsRejected()
    {
        var tooLarge = new byte[10 * 1024 * 1024 + 1];
        "%PDF-1.7\n"u8.CopyTo(tooLarge);

        var response = await Upload(tooLarge);

        Assert.Equal(["The file is larger than 10 MB."], await FileErrors(response));
    }

    [Fact]
    public async Task Post_WithoutAFile_IsRejected()
    {
        using var form = new MultipartFormDataContent { { new StringContent("hello"), "note" } };

        var response = await _client.PostAsync("/api/bank-statements", form);

        Assert.Equal(["Choose a PDF file to upload."], await FileErrors(response));
    }

    private async Task<int> AddRule(string keyword, int categoryId)
    {
        var response = await _client.PostAsJsonAsync("/api/categorization-rules", new { keyword, categoryId });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<SavedCategorizationRuleResponse>())!.Id;
    }

    private async Task<List<Transaction>> StoredTransactions(int statementId)
    {
        await using var user = await UserDatabase.OfAsync(_factory, _email);
        var db = user.Db;
        return await db.Transactions
            .Where(t => t.BankStatementId == statementId)
            .OrderBy(t => t.Id)
            .ToListAsync();
    }

    [Fact]
    public async Task Post_Statement_CategorizesMatchingRowsByRuleAndLeavesOthersUncategorized()
    {
        var ruleId = await AddRule("butikk", _categories.Groceries);

        var response = await Upload(StatementPdf.WithPurchasesFrom("Butikk Sentrum", "Kafé"));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<BankStatementResponse>();
        var stored = await StoredTransactions(created!.Id);
        Assert.Equal(
            [("Butikk Sentrum", (int?)_categories.Groceries, (int?)ruleId), ("Kafé", null, null)],
            stored.Select(t => (t.Description, t.CategoryId, t.CategorizationRuleId)));
    }

    [Fact]
    public async Task Post_PaymentToABareAccountNumber_IsCategorizedAsSavingsBySeededRule()
    {
        var pdf = StatementPdf.Create(
            StatementPdf.UniqueAccountNumber(),
            period: "01.08.2026 - 31.08.2026",
            openingBalance: "1.000,00",
            rows: [new("Til: 9999.88.77777 Betalt: 13.08.26", "1308", "100,00", null, "1308", "21", "12345678")],
            closingBalance: "900,00");

        var created = await Created(await Upload(pdf));

        var stored = (await StoredTransactions(created.Id)).Single();
        Assert.Equal(("Overføring til konto 9999.88.77777", (int?)_categories.Savings), (stored.Description, stored.CategoryId));
    }

    [Fact]
    public async Task Post_Statement_SeededRulesCategorizeClothingAndTransport()
    {
        var response = await Upload(StatementPdf.WithPurchasesFrom("Cubus Bergen Storsenter", "Skyss Billett"));

        var created = await Created(response);
        Assert.Equal(
            [_categories.Clothing, _categories.Transport],
            (await StoredTransactions(created.Id)).Select(t => t.CategoryId));
    }

    [Fact]
    public async Task Post_Statement_RowMatchingSeveralRulesGetsTheLongestKeywordsCategory()
    {
        await AddRule("butikk", _categories.Groceries);
        var longerRuleId = await AddRule("butikk kafé", _categories.Restaurants);

        var response = await Upload(StatementPdf.WithPurchasesFrom("BUTIKK KAFÉ Bryggen"));

        var created = await response.Content.ReadFromJsonAsync<BankStatementResponse>();
        var stored = Assert.Single(await StoredTransactions(created!.Id));
        Assert.Equal((_categories.Restaurants, longerRuleId), (stored.CategoryId, stored.CategorizationRuleId));
    }

    [Fact]
    public async Task Post_Statement_ReportsHowManyRowsStayedUncategorized()
    {
        await AddRule("butikk", _categories.Groceries);

        var response = await Upload(StatementPdf.WithPurchasesFrom(
            "Butikk Sentrum", "Kafé", "Frisør", "Butikk Torget"));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<BankStatementResponse>();
        Assert.Equal((4, 2), (created!.TransactionCount, created.UncategorizedCount));
    }

    // The User's rules other than the seeded ones they started with.
    private async Task<List<CategorizationRuleResponse>> AddedRules()
    {
        var rules = await _client.GetFromJsonAsync<List<CategorizationRuleResponse>>("/api/categorization-rules");
        return rules!.Where(r => !Seeds.Rules.Any(seed => seed.Keyword == r.Keyword)).ToList();
    }

    private static async Task<BankStatementResponse> Created(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<BankStatementResponse>())!;
    }

    [Fact]
    public async Task Post_UnmatchedRowWithValidProposal_CreatesAiGeneratedRuleThatCategorizesTheRow()
    {
        var generator = new FakeRuleGenerator()
            .Proposing("Kafé Bryggen", "  KAFÉ ", "Restaurants");

        var created = await Created(await Upload(
            StatementPdf.WithPurchasesFrom("Kafé Bryggen", "Frisør"), generator));

        var rule = Assert.Single(await AddedRules());
        Assert.Equal(("kafé", _categories.Restaurants, true), (rule.Keyword, rule.CategoryId, rule.AiGenerated));
        Assert.Equal(
            [
                ("Kafé Bryggen", (int?)_categories.Restaurants, (int?)rule.Id),
                ("Frisør", null, null),
            ],
            (await StoredTransactions(created.Id)).Select(t => (t.Description, t.CategoryId, t.CategorizationRuleId)));
        Assert.Equal((2, 1), (created.TransactionCount, created.UncategorizedCount));
    }

    [Fact]
    public async Task Post_ProposalWithCategoryOther_CreatesAiGeneratedRuleForOther()
    {
        var generator = new FakeRuleGenerator().Proposing("Frisør", "frisør", "Other");

        var created = await Created(await Upload(StatementPdf.WithPurchasesFrom("Frisør"), generator));

        var rule = Assert.Single(await AddedRules());
        Assert.Equal(("frisør", _categories.Other, true), (rule.Keyword, rule.CategoryId, rule.AiGenerated));
        var stored = Assert.Single(await StoredTransactions(created.Id));
        Assert.Equal(((int?)_categories.Other, (int?)rule.Id), (stored.CategoryId, stored.CategorizationRuleId));
        Assert.Equal(0, created.UncategorizedCount);
    }

    [Fact]
    public async Task Post_Statement_SendsOnlyTheDistinctUnmatchedRowsToTheGenerator()
    {
        await AddRule("butikk", _categories.Groceries);
        var generator = new FakeRuleGenerator();

        await Created(await Upload(
            StatementPdf.WithPurchasesFrom("Butikk Sentrum", "Kafé", "Kafé"), generator));

        var call = Assert.Single(generator.Calls);
        Assert.Equal([new UnmatchedRow("Kafé", AmountSign.Negative)], call.Rows);
    }

    [Fact]
    public async Task Post_StatementWhoseRowsAllMatchRules_DoesNotCallTheGenerator()
    {
        await AddRule("butikk", _categories.Groceries);
        var generator = new FakeRuleGenerator();

        await Created(await Upload(StatementPdf.WithPurchasesFrom("Butikk Sentrum", "Butikk Nord"), generator));

        Assert.Empty(generator.Calls);
    }

    [Fact]
    public async Task Post_Statement_GeneratorReceivesOnlyEachRowsDescriptionAndSignAndTheCategoryNamesAndDescriptions()
    {
        var pdf = StatementPdf.Create(
            StatementPdf.UniqueAccountNumber(),
            period: "01.08.2026 - 31.08.2026",
            openingBalance: "1.000,00",
            rows:
            [
                new("Varer 03.08 Kafé", "0408", "10,00", null, "0408", "21", "12345678"),
                new("Lønn", "0508", null, "50,00", "0508", "21", "12345678"),
            ],
            closingBalance: "1.040,00");
        var generator = new FakeRuleGenerator();

        await Created(await Upload(pdf, generator));

        var call = Assert.Single(generator.Calls);
        Assert.Equal(
            [new UnmatchedRow("Kafé", AmountSign.Negative), new UnmatchedRow("Lønn", AmountSign.Positive)],
            call.Rows);
        Assert.Equal(
            TestCategories.All.Select(c => new CategoryChoice(c.Name, c.Description)).OrderBy(c => c.Name),
            call.Categories.OrderBy(c => c.Name));
    }

    [Fact]
    public async Task Post_Statement_GeneratorReceivesACategorysEditedDescription()
    {
        const string edited = "Restaurant, takeaway, bakery, café and bar.";
        await SetDescription(_categories.Restaurants, edited);
        var generator = new FakeRuleGenerator();

        await Created(await Upload(StatementPdf.WithPurchasesFrom("Kafé"), generator));

        var call = Assert.Single(generator.Calls);
        Assert.Contains(new CategoryChoice("Restaurants", edited), call.Categories);
    }

    private async Task SetDescription(int categoryId, string description)
    {
        await using var user = await UserDatabase.OfAsync(_factory, _email);
        var db = user.Db;
        await db.Categories
            .Where(c => c.Id == categoryId)
            .ExecuteUpdateAsync(c => c.SetProperty(x => x.Description, description));
    }

    [Fact]
    public async Task Post_AiGeneratedRule_AlsoCategorizesAnUncategorizedTransactionFromAnEarlierImport()
    {
        var earlier = await Created(await Upload(StatementPdf.WithPurchasesFrom("Kafé Nord")));
        var generator = new FakeRuleGenerator().Proposing("Kafé Sør", "kafé", "Restaurants");

        await Created(await Upload(StatementPdf.WithPurchasesFrom("Kafé Sør"), generator));

        Assert.Equal(_categories.Restaurants, Assert.Single(await StoredTransactions(earlier.Id)).CategoryId);
    }

    private static string NewUploadId() => Guid.NewGuid().ToString();

    // Uploads one statement of a purchase from the merchant, for which the generator proposes the
    // merchant itself as an AI-generated rule.
    private Task<HttpResponseMessage> UploadAddingRuleFor(string merchant, string uploadId) =>
        Upload(StatementPdf.WithPurchasesFrom(merchant), new FakeRuleGenerator().Proposing(merchant, merchant, "Other"), uploadId);

    private async Task<Dictionary<string, bool>> IsNewByKeyword() =>
        (await AddedRules()).ToDictionary(r => r.Keyword, r => r.IsNew);

    [Fact]
    public async Task Post_RulesAddedByEveryBankStatementOfTheLatestUpload_AreNewUntilTheNextUploadImports()
    {
        var uploadId = NewUploadId();
        await Created(await UploadAddingRuleFor("kafé", uploadId));
        await Created(await UploadAddingRuleFor("frisør", uploadId));

        Assert.Equal(
            new Dictionary<string, bool> { ["kafé"] = true, ["frisør"] = true },
            await IsNewByKeyword());

        // The next Upload adds no rules, yet replaces the marks.
        await Created(await Upload(StatementPdf.WithPurchasesFrom("Rema 1000"), _client, NewUploadId()));

        Assert.Equal(
            new Dictionary<string, bool> { ["kafé"] = false, ["frisør"] = false },
            await IsNewByKeyword());
    }

    [Fact]
    public async Task Post_UploadWhoseBankStatementsAreAllRejected_KeepsTheNewMarks()
    {
        var pdf = StatementPdf.WithPurchasesFrom("kafé");
        await Created(await Upload(pdf, new FakeRuleGenerator().Proposing("kafé", "kafé", "Other"), NewUploadId()));

        Assert.Equal(HttpStatusCode.Conflict, (await Upload(pdf, _client, NewUploadId())).StatusCode);

        Assert.True(Assert.Single(await AddedRules()).IsNew);
    }

    [Fact]
    public async Task Post_WithoutAnUploadId_IsAnUploadOfItsOwn()
    {
        await Created(await UploadAddingRuleFor("kafé", NewUploadId()));
        await Created(await Upload(StatementPdf.WithPurchasesFrom("Rema 1000")));

        Assert.False(Assert.Single(await AddedRules()).IsNew);
    }

    [Fact]
    public async Task Post_WithAnInvalidUploadId_IsRejected()
    {
        var response = await Upload(ReconcilingStatement(StatementPdf.UniqueAccountNumber()), _client, "not-a-guid");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        Assert.Equal(["Upload id is not valid."], problem!.Errors["uploadId"]);
    }

    [Fact]
    public async Task Put_EditingANewRule_KeepsItNewButNoLongerAiGenerated()
    {
        await Created(await UploadAddingRuleFor("kafé", NewUploadId()));
        var rule = Assert.Single(await AddedRules());

        var response = await _client.PutAsJsonAsync(
            $"/api/categorization-rules/{rule.Id}", new { keyword = rule.Keyword, categoryId = _categories.Restaurants });

        var edited = await response.Content.ReadFromJsonAsync<SavedCategorizationRuleResponse>();
        Assert.Equal((false, true), (edited!.AiGenerated, edited.IsNew));
        Assert.True(Assert.Single(await AddedRules()).IsNew);
    }

    [Fact]
    public async Task Post_AiGeneratedRule_NeverChangesManuallyEnteredTransactions()
    {
        var response = await _client.PostAsJsonAsync("/api/transactions", new
        {
            date = "2026-08-03",
            description = "Kafé",
            amount = -100m,
            categoryId = _categories.Other,
        });
        var manual = await response.Content.ReadFromJsonAsync<TransactionResponse>();
        var generator = new FakeRuleGenerator().Proposing("Kafé Sør", "kafé", "Restaurants");

        await Created(await Upload(StatementPdf.WithPurchasesFrom("Kafé Sør"), generator));

        Assert.Single(await AddedRules());
        await using var user = await UserDatabase.OfAsync(_factory, _email);
        var db = user.Db;
        Assert.Equal(_categories.Other, (await db.Transactions.SingleAsync(t => t.Id == manual!.Id)).CategoryId);
    }

    // Uploads a statement whose one row gets the given proposal, and checks that the proposal was
    // dropped: no AI-generated rule is created, and the row stays Uncategorized.
    private async Task AssertDropped(string keyword, string categoryName, string? description = null)
    {
        description ??= "Kafé";
        var generator = new FakeRuleGenerator().Proposing(description, keyword, categoryName);

        var created = await Created(await Upload(StatementPdf.WithPurchasesFrom(description), generator));

        var stored = Assert.Single(await StoredTransactions(created.Id));
        Assert.Equal((null, null), (stored.CategoryId, stored.CategorizationRuleId));
        Assert.Equal(1, created.UncategorizedCount);
        Assert.DoesNotContain(await AddedRules(), r => r.AiGenerated);
    }

    [Fact]
    public async Task Post_ProposalWithUnknownCategory_IsDropped() =>
        await AssertDropped("kafé", "Cafés");

    [Theory]
    [InlineData("vipps")]
    [InlineData(" KLARNA ")]
    [InlineData("PayPal")]
    public async Task Post_ProposalWithAPaymentChannelAsKeyword_IsDropped(string keyword)
    {
        await AssertDropped(keyword, "Restaurants", description: keyword.Trim());

        var rules = await _client.GetFromJsonAsync<List<CategorizationRuleResponse>>("/api/categorization-rules");
        Assert.DoesNotContain(rules!, r => r.Keyword == keyword.Trim().ToLowerInvariant());
    }

    [Fact]
    public async Task Post_ProposalWithKeywordShorterThanTwoCharactersAfterTrimming_IsDropped() =>
        await AssertDropped(" k ", "Restaurants");

    [Fact]
    public async Task Post_ProposalWithKeywordLongerThanOneHundredCharacters_IsDropped() =>
        await AssertDropped(new string('x', 101), "Restaurants");

    [Fact]
    public async Task Post_ProposalWithKeywordThatExistsIgnoringCase_IsDropped()
    {
        await AddRule("bakeri", _categories.Groceries);

        await AssertDropped("BAKERI", "Restaurants");

        var rule = Assert.Single(await AddedRules());
        Assert.Equal(("bakeri", _categories.Groceries), (rule.Keyword, rule.CategoryId));
    }

    [Fact]
    public async Task Post_ProposalWithKeywordNotInItsDescription_IsDropped() =>
        await AssertDropped("kaffe", "Restaurants");

    [Fact]
    public async Task Post_ProposalThatWouldChangeTheCategoryOfAStoredTransaction_IsDropped()
    {
        await AddRule("matkroken", _categories.Groceries);
        var earlier = await Created(await Upload(StatementPdf.WithPurchasesFrom("Matkroken Bergen Storsenter")));
        var generator = new FakeRuleGenerator()
            .Proposing("Bergen Storsenter P-hus", "bergen storsenter", "Transport");

        var created = await Created(await Upload(StatementPdf.WithPurchasesFrom("Bergen Storsenter P-hus"), generator));

        Assert.DoesNotContain(await AddedRules(), r => r.AiGenerated);
        Assert.Equal(_categories.Groceries, Assert.Single(await StoredTransactions(earlier.Id)).CategoryId);
        Assert.Null(Assert.Single(await StoredTransactions(created.Id)).CategoryId);
    }

    [Fact]
    public async Task Post_ProposalThatWouldChangeTheCategoryOfARowInTheSameStatement_IsDropped()
    {
        await AddRule("matkroken", _categories.Groceries);
        var generator = new FakeRuleGenerator()
            .Proposing("Bergen Storsenter P-hus", "bergen storsenter", "Transport");

        var created = await Created(await Upload(
            StatementPdf.WithPurchasesFrom("Bergen Storsenter P-hus", "Matkroken Bergen Storsenter"), generator));

        Assert.DoesNotContain(await AddedRules(), r => r.AiGenerated);
        Assert.Equal([null, _categories.Groceries], (await StoredTransactions(created.Id)).Select(t => t.CategoryId));
    }

    [Fact]
    public async Task Post_TwoConflictingProposals_TheFirstInRowOrderWins()
    {
        // The second keyword is longer and also in the first row's description, so it would take
        // that row from the first rule.
        var generator = new FakeRuleGenerator()
            .Proposing("Kafé Sentrum Bergen", "kafé", "Restaurants")
            .Proposing("Sentrum Bergen P-hus", "sentrum bergen", "Transport");

        var created = await Created(await Upload(
            StatementPdf.WithPurchasesFrom("Kafé Sentrum Bergen", "Sentrum Bergen P-hus"), generator));

        var rule = Assert.Single(await AddedRules());
        Assert.Equal(("kafé", _categories.Restaurants, true), (rule.Keyword, rule.CategoryId, rule.AiGenerated));
        Assert.Equal([_categories.Restaurants, null], (await StoredTransactions(created.Id)).Select(t => t.CategoryId));
    }

    [Fact]
    public async Task Post_RowMatchedByAnAiGeneratedRuleCreatedEarlierInTheUpload_GetsNoRuleOfItsOwn()
    {
        var generator = new FakeRuleGenerator()
            .Proposing("Kaffebrenneriet Torget", "kaffebrenneriet", "Restaurants")
            .Proposing("Kaffebrenneriet Bryggen", "kaffebrenneriet bryggen", "Shopping");

        var created = await Created(await Upload(
            StatementPdf.WithPurchasesFrom("Kaffebrenneriet Torget", "Kaffebrenneriet Bryggen"), generator));

        var rule = Assert.Single(await AddedRules());
        Assert.Equal("kaffebrenneriet", rule.Keyword);
        Assert.Equal([(int?)_categories.Restaurants, _categories.Restaurants], (await StoredTransactions(created.Id)).Select(t => t.CategoryId));
    }

    [Fact]
    public async Task Post_TwoRowsWithTheSameDescription_ProduceOneRule()
    {
        // One spent and one received, so the generator is asked about each of them.
        var pdf = StatementPdf.Create(
            StatementPdf.UniqueAccountNumber(),
            period: "01.08.2026 - 31.08.2026",
            openingBalance: "1.000,00",
            rows:
            [
                new("Varer 03.08 Sport", "0408", "10,00", null, "0408", "21", "12345678"),
                new("Varer 05.08 Sport", "0508", null, "10,00", "0508", "21", "12345678"),
            ],
            closingBalance: "1.000,00");
        var generator = new FakeRuleGenerator().Proposing("Sport", "sport", "Shopping");

        var created = await Created(await Upload(pdf, generator));

        Assert.Equal(2, Assert.Single(generator.Calls).Rows.Count);
        Assert.Single(await AddedRules());
        Assert.Equal(0, created.UncategorizedCount);
    }

    [Fact]
    public async Task Post_GeneratorUnavailable_ImportsTheStatementWithUnmatchedRowsUncategorized()
    {
        await AddRule("butikk", _categories.Groceries);

        var created = await Created(await Upload(
            StatementPdf.WithPurchasesFrom("Butikk Sentrum", "Kafé"),
            new FakeRuleGenerator { Unavailable = true }));

        Assert.Equal(
            [(int?)_categories.Groceries, null],
            (await StoredTransactions(created.Id)).Select(t => t.CategoryId));
        Assert.Equal((2, 1), (created.TransactionCount, created.UncategorizedCount));
        Assert.True(created.AiCategorizationUnavailable);
    }

    [Fact]
    public async Task Post_GeneratorProposesNothing_DoesNotReportAiCategorizationUnavailable()
    {
        var created = await Created(await Upload(
            StatementPdf.WithPurchasesFrom("Kafé", "Frisør"), new FakeRuleGenerator()));

        Assert.Equal(2, created.UncategorizedCount);
        Assert.False(created.AiCategorizationUnavailable);
    }

    [Fact]
    public async Task Post_StatementWhoseRowsAllMatchRules_DoesNotReportAiCategorizationUnavailable()
    {
        await AddRule("butikk", _categories.Groceries);

        var created = await Created(await Upload(
            StatementPdf.WithPurchasesFrom("Butikk Sentrum"), new FakeRuleGenerator { Unavailable = true }));

        Assert.Equal(0, created.UncategorizedCount);
        Assert.False(created.AiCategorizationUnavailable);
    }

    [Fact]
    public async Task Post_NoGeneratorConfigured_LeavesUnmatchedRowsUncategorizedAndCreatesNoRules()
    {
        var created = await Created(await Upload(StatementPdf.WithPurchasesFrom("Kafé")));

        var stored = Assert.Single(await StoredTransactions(created.Id));
        Assert.Null(stored.CategoryId);
        Assert.Equal(1, created.UncategorizedCount);
        Assert.False(created.AiCategorizationUnavailable);
        Assert.Empty(await AddedRules());
    }

    // A statement of the account for the given month of 2026, with a purchase of 10,00 for each
    // merchant, from an opening balance of 1.000,00.
    private static byte[] StatementOfMonth(string accountNumber, int month, params string[] merchants)
    {
        var lastDay = DateTime.DaysInMonth(2026, month);
        return StatementPdf.Create(
            accountNumber,
            period: $"01.{month:D2}.2026 - {lastDay}.{month:D2}.2026",
            openingBalance: "1.000,00",
            rows: merchants.Select(m => new StatementPdfRow($"Varer 03.{month:D2} {m}", $"04{month:D2}", "10,00", null, $"04{month:D2}", "21", "12345678")),
            closingBalance: $"{1000 - 10 * merchants.Length},00");
    }

    private async Task<List<ListedBankStatementResponse>> ListedBankStatements() =>
        (await _client.GetFromJsonAsync<List<ListedBankStatementResponse>>("/api/bank-statements"))!;

    [Fact]
    public async Task Get_ListsTheUsersBankStatements_NewestPeriodFirst_WithTheirTransactionCounts()
    {
        var july = await Created(await Upload(StatementOfMonth("1111.11.11111", 7, "Kafé", "Frisør", "Rema 1000")));
        var augustOfAnother = await Created(await Upload(StatementOfMonth("2222.22.22222", 8, "Kafé")));
        var august = await Created(await Upload(StatementOfMonth("1111.11.11111", 8, "Kafé", "Frisør")));

        var listed = await ListedBankStatements();

        Assert.Equal(
            [
                (august.Id, "1111.11.11111", new DateOnly(2026, 8, 1), new DateOnly(2026, 8, 31), 2),
                (augustOfAnother.Id, "2222.22.22222", new DateOnly(2026, 8, 1), new DateOnly(2026, 8, 31), 1),
                (july.Id, "1111.11.11111", new DateOnly(2026, 7, 1), new DateOnly(2026, 7, 31), 3),
            ],
            listed.Select(s => (s.Id, s.AccountNumber, s.PeriodStart, s.PeriodEnd, s.TransactionCount)));
    }

    [Fact]
    public async Task Get_ListsEachBankStatementsImportDate_InNorwegianTime()
    {
        // Half past one at night in Norway, on the 1st of April, is still the 31st of March in UTC.
        var clock = new FakeClock(new DateTimeOffset(2099, 4, 1, 1, 30, 0, TimeSpan.FromHours(2)));
        await using (var api = _factory.WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services => services.AddSingleton<TimeProvider>(clock))))
        {
            using var client = await api.CreateClientSignedInAsAsync(_email);
            await Created(await Upload(StatementPdf.WithPurchasesFrom("Kafé"), client));
        }

        Assert.Equal(new DateOnly(2099, 4, 1), Assert.Single(await ListedBankStatements()).ImportedOn);
    }

    [Fact]
    public async Task Get_WithNoBankStatements_ListsNone() =>
        Assert.Empty(await ListedBankStatements());

    private Task<HttpResponseMessage> DeleteBankStatements(params int[] ids) =>
        _client.PostAsJsonAsync("/api/bank-statements/delete", new { ids });

    private async Task<List<TransactionResponse>> TransactionsOfMonth(int month) =>
        (await _client.GetFromJsonAsync<List<TransactionResponse>>($"/api/transactions?year=2026&month={month}"))!;

    [Fact]
    public async Task PostDelete_RemovesTheBankStatementsWithTheirTransactionsAndBookmarks()
    {
        var july = await Created(await Upload(StatementOfMonth("1111.11.11111", 7, "Kafé", "Frisør")));
        var august = await Created(await Upload(StatementOfMonth("1111.11.11111", 8, "Kafé", "Frisør", "Rema 1000")));
        var kept = await Created(await Upload(StatementOfMonth("2222.22.22222", 8, "Bakeri")));
        var manual = await _client.PostAsJsonAsync("/api/transactions", new
        {
            date = "2026-08-03", description = "Kiosk", amount = -100m, categoryId = _categories.Other,
        });
        Assert.Equal(HttpStatusCode.Created, manual.StatusCode);
        var bookmarked = (await TransactionsOfMonth(8)).First(t => t.Description == "Rema 1000");
        Assert.Equal(HttpStatusCode.OK, (await _client.PostAsync($"/api/transactions/{bookmarked.Id}/bookmark", null)).StatusCode);

        var response = await DeleteBankStatements(july.Id, august.Id);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(
            new DeletedBankStatementsResponse(BankStatementsDeleted: 2, TransactionsDeleted: 5),
            await response.Content.ReadFromJsonAsync<DeletedBankStatementsResponse>());
        Assert.Equal([kept.Id], (await ListedBankStatements()).Select(s => s.Id));
        Assert.Empty(await TransactionsOfMonth(7));
        Assert.Equal(["Bakeri", "Kiosk"], (await TransactionsOfMonth(8)).Select(t => t.Description).Order());
        Assert.Empty((await _client.GetFromJsonAsync<List<TransactionResponse>>("/api/bookmarks"))!);
    }

    [Fact]
    public async Task PostDelete_KeepsTheRulesTheImportsAdded_WithTheirAiGeneratedAndNewMarks()
    {
        await Created(await UploadAddingRuleFor("kafé", NewUploadId()));
        var latest = await Created(await UploadAddingRuleFor("frisør", NewUploadId()));
        var before = await AddedRules();

        Assert.Equal(HttpStatusCode.OK, (await DeleteBankStatements(latest.Id)).StatusCode);

        Assert.Equal(
            [("frisør", true, true), ("kafé", true, false)],
            (await AddedRules()).Select(r => (r.Keyword, r.AiGenerated, r.IsNew)));
        // Only how many Transactions they categorize changes, as the deleted ones go.
        Assert.Equal(before.Select(r => r.Keyword == "frisør" ? r with { TransactionCount = 0 } : r), await AddedRules());
    }

    [Fact]
    public async Task PostDelete_LetsTheSameBankStatementBeImportedAgain()
    {
        var pdf = StatementPdf.WithPurchasesFrom("Kafé", "Frisør");
        var first = await Created(await Upload(pdf));
        Assert.Equal(HttpStatusCode.OK, (await DeleteBankStatements(first.Id)).StatusCode);

        var again = await Created(await Upload(pdf));

        Assert.Equal(2, again.TransactionCount);
        Assert.Equal([again.Id], (await ListedBankStatements()).Select(s => s.Id));
    }

    [Fact]
    public async Task PostDelete_OfNoBankStatements_IsRefused()
    {
        await Created(await Upload(StatementPdf.WithPurchasesFrom("Kafé")));

        var empty = await DeleteBankStatements();
        var missing = await _client.PostAsJsonAsync("/api/bank-statements/delete", new { });

        foreach (var response in new[] { empty, missing })
        {
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
            Assert.Equal(["Choose at least one Bank Statement to delete."], problem!.Errors["ids"]);
        }
        Assert.Single(await ListedBankStatements());
    }

    [Fact]
    public async Task PostDelete_WithAnIdOfNoBankStatement_DeletesNothing()
    {
        var statement = await Created(await Upload(StatementPdf.WithPurchasesFrom("Kafé")));

        var response = await DeleteBankStatements(statement.Id, int.MaxValue);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        Assert.Equal(["A Bank Statement to delete no longer exists. Nothing was deleted."], problem!.Errors["ids"]);
        Assert.Equal([statement.Id], (await ListedBankStatements()).Select(s => s.Id));
    }

    private Task<HttpResponseMessage> DeleteAllTransactions() => _client.DeleteAsync("/api/transactions");

    private async Task<int> AddManualTransaction(string date, string description)
    {
        var response = await _client.PostAsJsonAsync("/api/transactions", new
        {
            date, description, amount = -100m, categoryId = _categories.Other,
        });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<TransactionResponse>())!.Id;
    }

    private async Task<List<TransactionMonthResponse>> MonthsWithTransactions() =>
        (await _client.GetFromJsonAsync<List<TransactionMonthResponse>>("/api/transactions/months"))!;

    [Fact]
    public async Task DeleteAllTransactions_RemovesTheManualAndImportedOnes_WithEveryBankStatementAndBookmark()
    {
        await Created(await Upload(StatementOfMonth("1111.11.11111", 7, "Kafé", "Frisør")));
        await Created(await Upload(StatementOfMonth("2222.22.22222", 8, "Bakeri", "Rema 1000", "Kiosk")));
        var manual = await AddManualTransaction("2026-09-03", "Kiosk");
        var imported = (await TransactionsOfMonth(8)).First(t => t.Description == "Rema 1000");
        foreach (var id in new[] { manual, imported.Id })
            Assert.Equal(HttpStatusCode.OK, (await _client.PostAsync($"/api/transactions/{id}/bookmark", null)).StatusCode);

        var response = await DeleteAllTransactions();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(
            new DeletedTransactionsResponse(TransactionsDeleted: 6),
            await response.Content.ReadFromJsonAsync<DeletedTransactionsResponse>());
        Assert.Empty(await MonthsWithTransactions());
        Assert.Empty(await ListedBankStatements());
        Assert.Empty((await _client.GetFromJsonAsync<List<TransactionResponse>>("/api/bookmarks"))!);
    }

    private async Task<DeleteCountsResponse> DeleteCounts() =>
        (await _client.GetFromJsonAsync<DeleteCountsResponse>("/api/user/delete-counts"))!;

    [Fact]
    public async Task GetDeleteCounts_CountsTheTransactions_ThatDeletingAllThenDeletes()
    {
        await Created(await Upload(StatementOfMonth("1111.11.11111", 7, "Kafé", "Frisør", "Bakeri")));
        await AddManualTransaction("2026-09-03", "Kiosk");

        var counted = (await DeleteCounts()).TransactionCount;
        var response = await DeleteAllTransactions();

        Assert.Equal(4, counted);
        Assert.Equal(counted, (await response.Content.ReadFromJsonAsync<DeletedTransactionsResponse>())!.TransactionsDeleted);
        Assert.Equal(0, (await DeleteCounts()).TransactionCount);
    }

    [Fact]
    public async Task DeleteAllTransactions_KeepsTheFoldersLastUsedFolderCategoriesAndRules_WithTheirMarks()
    {
        await Created(await UploadAddingRuleFor("kafé", NewUploadId()));
        var folder = await _client.PostAsJsonAsync("/api/folders", new { name = "Tax deductible" });
        Assert.Equal(HttpStatusCode.Created, folder.StatusCode);
        var folderId = (await folder.Content.ReadFromJsonAsync<FolderResponse>())!.Id;
        var kafé = Assert.Single(await TransactionsOfMonth(8));
        Assert.Equal(
            HttpStatusCode.OK,
            (await _client.PutAsJsonAsync($"/api/transactions/{kafé.Id}/bookmark", new { folderId })).StatusCode);
        var rules = await _client.GetFromJsonAsync<List<CategorizationRuleResponse>>("/api/categorization-rules");
        var categories = await CategoryNamesById();

        Assert.Equal(HttpStatusCode.OK, (await DeleteAllTransactions()).StatusCode);

        // Only how many Transactions they categorize changes, now that there are none.
        Assert.Equal(
            rules!.Select(r => r with { TransactionCount = 0 }),
            await _client.GetFromJsonAsync<List<CategorizationRuleResponse>>("/api/categorization-rules"));
        var added = Assert.Single(await AddedRules());
        Assert.Equal(("kafé", true, true), (added.Keyword, added.AiGenerated, added.IsNew));
        Assert.Equal(categories, await CategoryNamesById());
        Assert.Equal(
            [new FolderResponse(folderId, "Tax deductible")],
            (await _client.GetFromJsonAsync<List<FolderResponse>>("/api/folders"))!);
        // The next Bookmark still goes into the last used folder.
        var next = await AddManualTransaction("2026-09-03", "Kiosk");
        var bookmarked = await _client.PostAsync($"/api/transactions/{next}/bookmark", null);
        Assert.Equal(new BookmarkResponse(folderId), await bookmarked.Content.ReadFromJsonAsync<BookmarkResponse>());
    }

    private async Task<Dictionary<int, string>> CategoryNamesById() =>
        (await _client.GetFromJsonAsync<List<CategoryResponse>>("/api/categories"))!.ToDictionary(c => c.Id, c => c.Name);

    [Fact]
    public async Task DeleteAllTransactions_LetsEachBankStatementBeImportedAgain()
    {
        var july = StatementOfMonth("1111.11.11111", 7, "Kafé", "Frisør");
        var august = StatementOfMonth("2222.22.22222", 8, "Bakeri");
        await Created(await Upload(july));
        await Created(await Upload(august));
        Assert.Equal(HttpStatusCode.OK, (await DeleteAllTransactions()).StatusCode);

        Assert.Equal(2, (await Created(await Upload(july))).TransactionCount);
        Assert.Equal(1, (await Created(await Upload(august))).TransactionCount);
        Assert.Equal(2, (await ListedBankStatements()).Count);
    }

    [Fact]
    public async Task DeleteAllTransactions_WithNoTransactions_DeletesNone()
    {
        var response = await DeleteAllTransactions();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(new DeletedTransactionsResponse(0), await response.Content.ReadFromJsonAsync<DeletedTransactionsResponse>());
    }
}
