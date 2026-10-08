using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PersonligFinans.Api.BankStatements;
using PersonligFinans.Api.CategorizationRules;
using PersonligFinans.Api.Data;
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

    // The tests share one database and rules match every imported Transaction, so the tests that
    // add rules put a token of their own in each keyword and description.
    private readonly string _token = "t" + Guid.NewGuid().ToString("N")[..8];

    public BankStatementEndpointsTests(PostgresApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    private async Task<HttpResponseMessage> Upload(byte[] pdf)
    {
        var file = new ByteArrayContent(pdf);
        file.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
        using var form = new MultipartFormDataContent { { file, "file", "kontoutskrift.pdf" } };
        return await _client.PostAsync("/api/bank-statements", form);
    }

    [Fact]
    public async Task Post_OnePageStatement_StoresUncategorizedTransactionsLinkedToStatement()
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
        Assert.All(stored, t => Assert.Null(t.CategoryId));
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
        return (await response.Content.ReadFromJsonAsync<CreatedCategorizationRuleResponse>())!.Id;
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
            $"{_token} Butikk Sentrum", $"{_token} Kafé", $"{_token} Kino", $"{_token} Butikk Torget"));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<BankStatementResponse>();
        Assert.Equal((4, 2), (created!.TransactionCount, created.UncategorizedCount));
    }
}
