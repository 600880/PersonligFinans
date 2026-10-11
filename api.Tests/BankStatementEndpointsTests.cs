using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PersonligFinans.Api.BankStatements;
using PersonligFinans.Api.CategorizationRules;
using PersonligFinans.Api.Data;
using PersonligFinans.Api.Transactions;
using UglyToad.PdfPig.Content;
using UglyToad.PdfPig.Core;
using UglyToad.PdfPig.Fonts.Standard14Fonts;
using UglyToad.PdfPig.Writer;

namespace PersonligFinans.Api.Tests;

[Collection(ApiCollection.Name)]
public class BankStatementEndpointsTests
{
    private readonly PostgresApiFactory _factory;
    private readonly HttpClient _client;

    private const int GroceriesId = 1;
    private const int RestaurantsId = 2;
    private const int TransfersId = 12;
    private const int OtherId = 13;
    private const int ClothingId = 14;
    private const int ElectronicsId = 15;

    // The tests share one database and rules match every imported Transaction, so the tests that
    // add rules put a token of their own in each keyword and description.
    private readonly string _token = "t" + Guid.NewGuid().ToString("N")[..8];

    public BankStatementEndpointsTests(PostgresApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    // Uploads to the API as configured by default, with no rule generator.
    private Task<HttpResponseMessage> Upload(byte[] pdf) => Upload(pdf, _client);

    // Uploads to an API that has the given rule generator.
    private async Task<HttpResponseMessage> Upload(byte[] pdf, IRuleGenerator ruleGenerator)
    {
        await using var api = _factory.WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services => services.AddSingleton(ruleGenerator)));
        using var client = api.CreateClient();
        return await Upload(pdf, client);
    }

    private static async Task<HttpResponseMessage> Upload(byte[] pdf, HttpClient client)
    {
        var file = new ByteArrayContent(pdf);
        file.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
        using var form = new MultipartFormDataContent { { file, "file", "kontoutskrift.pdf" } };
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

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
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
        Assert.Equal([null, null, GroceriesId, TransfersId, null], stored.Select(t => t.CategoryId));
        Assert.All(stored, t => Assert.Null(t.Reference));
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

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
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
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
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

    private static string UniqueAccountNumber()
    {
        var digits = Random.Shared.NextInt64(0, 100_000_000_000).ToString("D11");
        return $"{digits[..4]}.{digits[4..6]}.{digits[6..]}";
    }

    private async Task<int> AddRule(string keyword, int categoryId)
    {
        var response = await _client.PostAsJsonAsync("/api/categorization-rules", new { keyword, categoryId });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<SavedCategorizationRuleResponse>())!.Id;
    }

    // Each row is a purchase of 10,00 from the given merchant, from an opening balance of 1.000,00.
    private static byte[] StatementWithPurchasesFrom(params string[] merchants) =>
        StatementPdf.Create(
            UniqueAccountNumber(),
            period: "01.08.2026 - 31.08.2026",
            openingBalance: "1.000,00",
            rows: merchants.Select(m => new StatementPdfRow($"Varer 03.08 {m}", "0408", "10,00", null, "0408", "21", "12345678")),
            closingBalance: $"{1000 - 10 * merchants.Length},00");

    private async Task<List<Transaction>> StoredTransactions(int statementId)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await db.Transactions
            .Where(t => t.BankStatementId == statementId)
            .OrderBy(t => t.Id)
            .ToListAsync();
    }

    [Fact]
    public async Task Post_Statement_CategorizesMatchingRowsByRuleAndLeavesOthersUncategorized()
    {
        var ruleId = await AddRule($"{_token} butikk", GroceriesId);

        var response = await Upload(StatementWithPurchasesFrom($"{_token} Butikk Sentrum", $"{_token} Kafé"));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<BankStatementResponse>();
        var stored = await StoredTransactions(created!.Id);
        Assert.Equal(
            [($"{_token} Butikk Sentrum", (int?)GroceriesId, (int?)ruleId), ($"{_token} Kafé", null, null)],
            stored.Select(t => (t.Description, t.CategoryId, t.CategorizationRuleId)));
    }

    [Fact]
    public async Task Post_PaymentToABareAccountNumber_IsCategorizedAsTransfersBySeededRule()
    {
        var pdf = StatementPdf.Create(
            UniqueAccountNumber(),
            period: "01.08.2026 - 31.08.2026",
            openingBalance: "1.000,00",
            rows: [new("Til: 9999.88.77777 Betalt: 13.08.26", "1308", "100,00", null, "1308", "21", "12345678")],
            closingBalance: "900,00");

        var created = await Created(await Upload(pdf));

        var stored = (await StoredTransactions(created.Id)).Single();
        Assert.Equal(("Overføring til konto 9999.88.77777", (int?)TransfersId), (stored.Description, stored.CategoryId));
    }

    [Fact]
    public async Task Post_Statement_SeededRulesCategorizeClothingAndElectronics()
    {
        var response = await Upload(StatementWithPurchasesFrom("Cubus Bergen Storsenter", "Komplett.no"));

        var created = await Created(response);
        Assert.Equal(
            [ClothingId, ElectronicsId],
            (await StoredTransactions(created.Id)).Select(t => t.CategoryId));
    }

    [Fact]
    public async Task Post_Statement_RowMatchingSeveralRulesGetsTheLongestKeywordsCategory()
    {
        await AddRule($"{_token} butikk", GroceriesId);
        var longerRuleId = await AddRule($"{_token} butikk kafé", RestaurantsId);

        var response = await Upload(StatementWithPurchasesFrom($"{_token} BUTIKK KAFÉ Bryggen"));

        var created = await response.Content.ReadFromJsonAsync<BankStatementResponse>();
        var stored = Assert.Single(await StoredTransactions(created!.Id));
        Assert.Equal((RestaurantsId, longerRuleId), (stored.CategoryId, stored.CategorizationRuleId));
    }

    [Fact]
    public async Task Post_Statement_ReportsHowManyRowsStayedUncategorized()
    {
        await AddRule($"{_token} butikk", GroceriesId);

        var response = await Upload(StatementWithPurchasesFrom(
            $"{_token} Butikk Sentrum", $"{_token} Kafé", $"{_token} Frisør", $"{_token} Butikk Torget"));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<BankStatementResponse>();
        Assert.Equal((4, 2), (created!.TransactionCount, created.UncategorizedCount));
    }

    private async Task<List<CategorizationRuleResponse>> RulesWithToken()
    {
        var rules = await _client.GetFromJsonAsync<List<CategorizationRuleResponse>>("/api/categorization-rules");
        return rules!.Where(r => r.Keyword.Contains(_token)).ToList();
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
            .Proposing($"{_token} Kafé Bryggen", $"  {_token.ToUpperInvariant()} KAFÉ ", "Restaurants");

        var created = await Created(await Upload(
            StatementWithPurchasesFrom($"{_token} Kafé Bryggen", $"{_token} Frisør"), generator));

        var rule = Assert.Single(await RulesWithToken());
        Assert.Equal(($"{_token} kafé", RestaurantsId, true), (rule.Keyword, rule.CategoryId, rule.AiGenerated));
        Assert.Equal(
            [
                ($"{_token} Kafé Bryggen", (int?)RestaurantsId, (int?)rule.Id, false),
                ($"{_token} Frisør", OtherId, null, true),
            ],
            (await StoredTransactions(created.Id))
                .Select(t => (t.Description, t.CategoryId, t.CategorizationRuleId, t.AiPlacedInOther)));
        Assert.Equal((2, 0), (created.TransactionCount, created.UncategorizedCount));
    }

    [Fact]
    public async Task Post_DeclinedRow_IsAiPlacedInOtherAndCreatesNoRule()
    {
        var created = await Created(await Upload(StatementWithPurchasesFrom($"{_token} Frisør"), new FakeRuleGenerator()));

        Assert.Empty(await RulesWithToken());
        var stored = Assert.Single(await StoredTransactions(created.Id));
        Assert.Equal((OtherId, null, true), (stored.CategoryId, stored.CategorizationRuleId, stored.AiPlacedInOther));
        Assert.Equal(0, created.UncategorizedCount);
    }

    [Fact]
    public async Task Post_Statement_SendsOnlyTheDistinctUnmatchedRowsToTheGenerator()
    {
        await AddRule($"{_token} butikk", GroceriesId);
        var generator = new FakeRuleGenerator();

        await Created(await Upload(
            StatementWithPurchasesFrom($"{_token} Butikk Sentrum", $"{_token} Kafé", $"{_token} Kafé"), generator));

        var call = Assert.Single(generator.Calls);
        Assert.Equal([new UnmatchedRow($"{_token} Kafé", AmountSign.Negative)], call.Rows);
    }

    [Fact]
    public async Task Post_StatementWhoseRowsAllMatchRules_DoesNotCallTheGenerator()
    {
        await AddRule($"{_token} butikk", GroceriesId);
        var generator = new FakeRuleGenerator();

        await Created(await Upload(StatementWithPurchasesFrom($"{_token} Butikk Sentrum", $"{_token} Butikk Nord"), generator));

        Assert.Empty(generator.Calls);
    }

    [Fact]
    public async Task Post_Statement_GeneratorReceivesOnlyEachRowsDescriptionAndSignAndTheCategoryNamesAndDescriptions()
    {
        var pdf = StatementPdf.Create(
            UniqueAccountNumber(),
            period: "01.08.2026 - 31.08.2026",
            openingBalance: "1.000,00",
            rows:
            [
                new($"Varer 03.08 {_token} Kafé", "0408", "10,00", null, "0408", "21", "12345678"),
                new($"{_token} Lønn", "0508", null, "50,00", "0508", "21", "12345678"),
            ],
            closingBalance: "1.040,00");
        var generator = new FakeRuleGenerator();

        await Created(await Upload(pdf, generator));

        var call = Assert.Single(generator.Calls);
        Assert.Equal(
            [new UnmatchedRow($"{_token} Kafé", AmountSign.Negative), new UnmatchedRow($"{_token} Lønn", AmountSign.Positive)],
            call.Rows);
        // "Other" is where the import puts a row the rule generator declines, never offered to it.
        Assert.Equal(
            SeedCategories.All.Where(c => c.Name != "Other").Select(c => new CategoryChoice(c.Name, c.Description)).OrderBy(c => c.Name),
            call.Categories.OrderBy(c => c.Name));
    }

    [Fact]
    public async Task Post_Statement_GeneratorReceivesACategorysEditedDescription()
    {
        const string edited = "Restaurant, takeaway, bakery, café and bar.";
        await SetDescription(RestaurantsId, edited);
        try
        {
            var generator = new FakeRuleGenerator();

            await Created(await Upload(StatementWithPurchasesFrom($"{_token} Kafé"), generator));

            var call = Assert.Single(generator.Calls);
            Assert.Contains(new CategoryChoice("Restaurants", edited), call.Categories);
        }
        finally
        {
            // The tests share one database.
            await SetDescription(RestaurantsId, SeedCategories.All.Single(c => c.Id == RestaurantsId).Description);
        }
    }

    private async Task SetDescription(int categoryId, string description)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Categories
            .Where(c => c.Id == categoryId)
            .ExecuteUpdateAsync(c => c.SetProperty(x => x.Description, description));
    }

    [Fact]
    public async Task Post_AiGeneratedRule_AlsoCategorizesAnUncategorizedTransactionFromAnEarlierImport()
    {
        var earlier = await Created(await Upload(StatementWithPurchasesFrom($"{_token} Kafé Nord")));
        var generator = new FakeRuleGenerator().Proposing($"{_token} Kafé Sør", $"{_token} kafé", "Restaurants");

        await Created(await Upload(StatementWithPurchasesFrom($"{_token} Kafé Sør"), generator));

        Assert.Equal(RestaurantsId, Assert.Single(await StoredTransactions(earlier.Id)).CategoryId);
    }

    [Fact]
    public async Task Post_AiGeneratedRule_ClaimsATransactionAnEarlierImportAiPlacedInOther()
    {
        var earlier = await Created(await Upload(StatementWithPurchasesFrom($"{_token} Kafé Nord"), new FakeRuleGenerator()));
        var generator = new FakeRuleGenerator().Proposing($"{_token} Kafé Sør", $"{_token} kafé", "Restaurants");

        await Created(await Upload(StatementWithPurchasesFrom($"{_token} Kafé Sør"), generator));

        var rule = Assert.Single(await RulesWithToken());
        Assert.True(rule.AiGenerated);
        var claimed = Assert.Single(await StoredTransactions(earlier.Id));
        Assert.Equal((RestaurantsId, rule.Id), (claimed.CategoryId, claimed.CategorizationRuleId));
    }

    [Fact]
    public async Task Post_AiGeneratedRule_NeverChangesManuallyEnteredTransactions()
    {
        var response = await _client.PostAsJsonAsync("/api/transactions", new
        {
            date = "2026-08-03",
            description = $"{_token} Kafé",
            amount = -100m,
            categoryId = OtherId,
        });
        var manual = await response.Content.ReadFromJsonAsync<TransactionResponse>();
        var generator = new FakeRuleGenerator().Proposing($"{_token} Kafé Sør", $"{_token} kafé", "Restaurants");

        await Created(await Upload(StatementWithPurchasesFrom($"{_token} Kafé Sør"), generator));

        Assert.Single(await RulesWithToken());
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Equal(OtherId, (await db.Transactions.SingleAsync(t => t.Id == manual!.Id)).CategoryId);
    }

    // Uploads a statement whose one row gets the given proposal, and checks that the proposal was
    // dropped: no AI-generated rule is created, and the row is AI-placed in Other as if declined.
    private async Task AssertDropped(string keyword, string categoryName)
    {
        var generator = new FakeRuleGenerator().Proposing($"{_token} Kafé", keyword, categoryName);

        var created = await Created(await Upload(StatementWithPurchasesFrom($"{_token} Kafé"), generator));

        var stored = Assert.Single(await StoredTransactions(created.Id));
        Assert.Equal((OtherId, null, true), (stored.CategoryId, stored.CategorizationRuleId, stored.AiPlacedInOther));
        Assert.Equal(0, created.UncategorizedCount);
        Assert.DoesNotContain(await RulesWithToken(), r => r.AiGenerated);
    }

    [Fact]
    public async Task Post_ProposalWithUnknownCategory_IsDropped() =>
        await AssertDropped($"{_token} kafé", "Cafés");

    [Fact]
    public async Task Post_ProposalWithCategoryOther_IsDropped() =>
        await AssertDropped($"{_token} kafé", "Other");

    [Fact]
    public async Task Post_ProposalWithKeywordShorterThanTwoCharactersAfterTrimming_IsDropped() =>
        await AssertDropped(" k ", "Restaurants");

    [Fact]
    public async Task Post_ProposalWithKeywordLongerThanOneHundredCharacters_IsDropped() =>
        await AssertDropped(_token + new string('x', 100), "Restaurants");

    [Fact]
    public async Task Post_ProposalWithKeywordThatExistsIgnoringCase_IsDropped()
    {
        await AddRule($"{_token} bakeri", GroceriesId);

        await AssertDropped($"{_token.ToUpperInvariant()} BAKERI", "Restaurants");

        var rule = Assert.Single(await RulesWithToken());
        Assert.Equal(($"{_token} bakeri", GroceriesId), (rule.Keyword, rule.CategoryId));
    }

    [Fact]
    public async Task Post_ProposalWithKeywordNotInItsDescription_IsDropped() =>
        await AssertDropped($"{_token} kaffe", "Restaurants");

    [Fact]
    public async Task Post_ProposalThatWouldChangeTheCategoryOfAStoredTransaction_IsDropped()
    {
        await AddRule($"rema {_token}", GroceriesId);
        var earlier = await Created(await Upload(StatementWithPurchasesFrom($"Rema {_token} Bergen Storsenter")));
        var generator = new FakeRuleGenerator()
            .Proposing($"{_token} Bergen Storsenter P-hus", $"{_token} bergen storsenter", "Transport");

        var created = await Created(await Upload(StatementWithPurchasesFrom($"{_token} Bergen Storsenter P-hus"), generator));

        Assert.DoesNotContain(await RulesWithToken(), r => r.AiGenerated);
        Assert.Equal(GroceriesId, Assert.Single(await StoredTransactions(earlier.Id)).CategoryId);
        Assert.Equal(OtherId, Assert.Single(await StoredTransactions(created.Id)).CategoryId);
    }

    [Fact]
    public async Task Post_ProposalThatWouldChangeTheCategoryOfARowInTheSameStatement_IsDropped()
    {
        await AddRule($"rema {_token}", GroceriesId);
        var generator = new FakeRuleGenerator()
            .Proposing($"{_token} Bergen Storsenter P-hus", $"{_token} bergen storsenter", "Transport");

        var created = await Created(await Upload(
            StatementWithPurchasesFrom($"{_token} Bergen Storsenter P-hus", $"Rema {_token} Bergen Storsenter"), generator));

        Assert.DoesNotContain(await RulesWithToken(), r => r.AiGenerated);
        Assert.Equal([OtherId, GroceriesId], (await StoredTransactions(created.Id)).Select(t => t.CategoryId));
    }

    [Fact]
    public async Task Post_TwoConflictingProposals_TheFirstInRowOrderWins()
    {
        // The second keyword is longer and also in the first row's description, so it would take
        // that row from the first rule.
        var generator = new FakeRuleGenerator()
            .Proposing($"Kafé {_token} Sentrum Bergen", $"kafé {_token}", "Restaurants")
            .Proposing($"{_token} Sentrum Bergen P-hus", $"{_token} sentrum bergen", "Transport");

        var created = await Created(await Upload(
            StatementWithPurchasesFrom($"Kafé {_token} Sentrum Bergen", $"{_token} Sentrum Bergen P-hus"), generator));

        var rule = Assert.Single(await RulesWithToken());
        Assert.Equal(($"kafé {_token}", RestaurantsId, true), (rule.Keyword, rule.CategoryId, rule.AiGenerated));
        Assert.Equal([RestaurantsId, OtherId], (await StoredTransactions(created.Id)).Select(t => t.CategoryId));
    }

    [Fact]
    public async Task Post_RowMatchedByAnAiGeneratedRuleCreatedEarlierInTheUpload_GetsNoRuleOfItsOwn()
    {
        var generator = new FakeRuleGenerator()
            .Proposing($"{_token} Kaffebrenneriet Torget", $"{_token} kaffebrenneriet", "Restaurants")
            .Proposing($"{_token} Kaffebrenneriet Bryggen", $"{_token} kaffebrenneriet bryggen", "Shopping");

        var created = await Created(await Upload(
            StatementWithPurchasesFrom($"{_token} Kaffebrenneriet Torget", $"{_token} Kaffebrenneriet Bryggen"), generator));

        var rule = Assert.Single(await RulesWithToken());
        Assert.Equal($"{_token} kaffebrenneriet", rule.Keyword);
        Assert.Equal([(int?)RestaurantsId, RestaurantsId], (await StoredTransactions(created.Id)).Select(t => t.CategoryId));
    }

    [Fact]
    public async Task Post_TwoRowsWithTheSameDescription_ProduceOneRule()
    {
        // One spent and one received, so the generator is asked about each of them.
        var pdf = StatementPdf.Create(
            UniqueAccountNumber(),
            period: "01.08.2026 - 31.08.2026",
            openingBalance: "1.000,00",
            rows:
            [
                new($"Varer 03.08 {_token} Sport", "0408", "10,00", null, "0408", "21", "12345678"),
                new($"Varer 05.08 {_token} Sport", "0508", null, "10,00", "0508", "21", "12345678"),
            ],
            closingBalance: "1.000,00");
        var generator = new FakeRuleGenerator().Proposing($"{_token} Sport", $"{_token} sport", "Shopping");

        var created = await Created(await Upload(pdf, generator));

        Assert.Equal(2, Assert.Single(generator.Calls).Rows.Count);
        Assert.Single(await RulesWithToken());
        Assert.Equal(0, created.UncategorizedCount);
    }

    [Fact]
    public async Task Post_GeneratorUnavailable_ImportsTheStatementWithUnmatchedRowsUncategorized()
    {
        await AddRule($"{_token} butikk", GroceriesId);

        var created = await Created(await Upload(
            StatementWithPurchasesFrom($"{_token} Butikk Sentrum", $"{_token} Kafé"),
            new FakeRuleGenerator { Unavailable = true }));

        Assert.Equal(
            [((int?)GroceriesId, false), (null, false)],
            (await StoredTransactions(created.Id)).Select(t => (t.CategoryId, t.AiPlacedInOther)));
        Assert.Equal((2, 1), (created.TransactionCount, created.UncategorizedCount));
        Assert.True(created.AiCategorizationUnavailable);
    }

    [Fact]
    public async Task Post_GeneratorDeclinesEveryRow_DoesNotReportAiCategorizationUnavailable()
    {
        var created = await Created(await Upload(
            StatementWithPurchasesFrom($"{_token} Kafé", $"{_token} Frisør"), new FakeRuleGenerator()));

        Assert.Equal(0, created.UncategorizedCount);
        Assert.False(created.AiCategorizationUnavailable);
    }

    [Fact]
    public async Task Post_StatementWhoseRowsAllMatchRules_DoesNotReportAiCategorizationUnavailable()
    {
        await AddRule($"{_token} butikk", GroceriesId);

        var created = await Created(await Upload(
            StatementWithPurchasesFrom($"{_token} Butikk Sentrum"), new FakeRuleGenerator { Unavailable = true }));

        Assert.Equal(0, created.UncategorizedCount);
        Assert.False(created.AiCategorizationUnavailable);
    }

    [Fact]
    public async Task Post_NoGeneratorConfigured_LeavesUnmatchedRowsUncategorizedAndCreatesNoRules()
    {
        var created = await Created(await Upload(StatementWithPurchasesFrom($"{_token} Kafé")));

        var stored = Assert.Single(await StoredTransactions(created.Id));
        Assert.Equal((null, false), (stored.CategoryId, stored.AiPlacedInOther));
        Assert.Equal(1, created.UncategorizedCount);
        Assert.False(created.AiCategorizationUnavailable);
        Assert.Empty(await RulesWithToken());
    }
}
