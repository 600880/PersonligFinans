using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PersonligFinans.Api.Data;
using PersonligFinans.Api.Transactions;
using Xunit;

namespace PersonligFinans.Api.Tests;

[Collection(ApiCollection.Name)]
public class TransactionEndpointsTests
{
    private const int OtherCategoryId = 13;
    private const int ClothingCategoryId = 14;
    private const int ElectronicsCategoryId = 15;

    private readonly PostgresApiFactory _factory;
    private readonly HttpClient _client;

    // The tests share one database, so the listing tests use years no other test uses and put a
    // token of their own in each description.
    private readonly string _token = "t" + Guid.NewGuid().ToString("N")[..8];

    public TransactionEndpointsTests(PostgresApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    private static object ValidRequest(
        string? date = "2026-09-24",
        string? description = "Rema 1000",
        decimal? amount = -249.90m,
        string? reference = null,
        int? categoryId = OtherCategoryId) =>
        new { date, description, amount, reference, categoryId };

    private async Task<Dictionary<string, string[]>> PostExpectingValidationErrors(object request)
    {
        var response = await _client.PostAsJsonAsync("/api/transactions", request);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        return new Dictionary<string, string[]>(problem!.Errors);
    }

    [Fact]
    public async Task Get_Categories_ReturnsSeededList()
    {
        var categories = await _client.GetFromJsonAsync<List<CategoryResponse>>("/api/categories");

        Assert.Equal(15, categories!.Count);
        Assert.Contains(categories, c => c.Name == "Groceries");
        Assert.Contains(categories, c => c is { Id: OtherCategoryId, Name: "Other" });
        Assert.Contains(categories, c => c is { Id: ClothingCategoryId, Name: "Clothing" });
        Assert.Contains(categories, c => c is { Id: ElectronicsCategoryId, Name: "Electronics" });
    }

    [Fact]
    public async Task Post_ValidTransaction_StoresItAndReturnsCreated()
    {
        var response = await _client.PostAsJsonAsync(
            "/api/transactions",
            ValidRequest(description: "  Invoice 42 paid  ", amount: 1500m, reference: "INV-42"));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<TransactionResponse>();

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var stored = await db.Transactions.SingleAsync(t => t.Id == created!.Id);
        Assert.Equal(new DateOnly(2026, 9, 24), stored.PostedDate);
        Assert.Equal("Invoice 42 paid", stored.Description);
        Assert.Equal(1500m, stored.Amount);
        Assert.Equal("INV-42", stored.Reference);
        Assert.Equal(OtherCategoryId, stored.CategoryId);
        Assert.Null(stored.BankStatementId);
    }

    [Fact]
    public async Task Post_BlankReference_IsStoredAsNull()
    {
        var response = await _client.PostAsJsonAsync("/api/transactions", ValidRequest(reference: "   "));

        var created = await response.Content.ReadFromJsonAsync<TransactionResponse>();
        Assert.Null(created!.Reference);
    }

    [Fact]
    public async Task Post_MissingFields_ReturnsErrorPerField()
    {
        var errors = await PostExpectingValidationErrors(
            ValidRequest(date: null, description: " ", amount: null, categoryId: null));

        Assert.Equal(["amount", "categoryId", "date", "description"], errors.Keys.Order());
    }

    [Fact]
    public async Task Post_ZeroAmount_IsRejected()
    {
        var errors = await PostExpectingValidationErrors(ValidRequest(amount: 0m));

        Assert.Contains("amount", errors.Keys);
    }

    [Fact]
    public async Task Post_AmountWithMoreThanTwoDecimals_IsRejected()
    {
        var errors = await PostExpectingValidationErrors(ValidRequest(amount: 10.005m));

        Assert.Contains("amount", errors.Keys);
    }

    [Fact]
    public async Task Post_UnknownCategory_IsRejected()
    {
        var errors = await PostExpectingValidationErrors(ValidRequest(categoryId: 9999));

        Assert.Contains("categoryId", errors.Keys);
    }

    [Fact]
    public async Task Post_TooLongDescriptionAndReference_AreRejected()
    {
        var errors = await PostExpectingValidationErrors(
            ValidRequest(description: new string('x', 201), reference: new string('x', 101)));

        Assert.Contains("description", errors.Keys);
        Assert.Contains("reference", errors.Keys);
    }

    private async Task AddManualTransaction(string date, string description)
    {
        var response = await _client.PostAsJsonAsync(
            "/api/transactions",
            ValidRequest(date: date, description: description));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    // Imports a statement of one month with a purchase of 10,00 per row. Each row is a booked date
    // (DDMM) and a description no rule matches, so the imported Transactions are Uncategorized.
    private async Task ImportStatement(string period, params (string BookedDate, string Description)[] rows)
    {
        var digits = Random.Shared.NextInt64(0, 100_000_000_000).ToString("D11");
        var pdf = StatementPdf.Create(
            accountNumber: $"{digits[..4]}.{digits[4..6]}.{digits[6..]}",
            period,
            openingBalance: "1.000,00",
            rows: rows.Select(r => new StatementPdfRow(r.Description, r.BookedDate, "10,00", null, r.BookedDate, "21", "12345678")),
            closingBalance: $"{1000 - 10 * rows.Length},00");
        var file = new ByteArrayContent(pdf);
        file.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
        using var form = new MultipartFormDataContent { { file, "file", "kontoutskrift.pdf" } };

        var response = await _client.PostAsync("/api/bank-statements", form);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    private async Task<List<TransactionResponse>> OwnTransactionsOf(int year, int month)
    {
        var transactions = await _client.GetFromJsonAsync<List<TransactionResponse>>(
            $"/api/transactions?year={year}&month={month}");
        return transactions!.Where(t => t.Description.StartsWith(_token)).ToList();
    }

    [Fact]
    public async Task Get_Months_ListsEachMonthWithTransactionsOnceNewestFirst()
    {
        await AddManualTransaction("2041-03-05", $"{_token} manual");
        await AddManualTransaction("2041-03-20", $"{_token} manual again");
        await ImportStatement("01.05.2041 - 31.05.2041", ("0405", $"{_token} imported"));

        var months = (await _client.GetFromJsonAsync<List<TransactionMonthResponse>>("/api/transactions/months"))!;

        Assert.Contains(new TransactionMonthResponse(2041, 5), months);
        Assert.Contains(new TransactionMonthResponse(2041, 3), months);
        Assert.DoesNotContain(new TransactionMonthResponse(2041, 4), months);
        Assert.Equal(months.Distinct(), months);
        Assert.Equal(months.OrderByDescending(m => m.Year).ThenByDescending(m => m.Month), months);
    }

    [Fact]
    public async Task Get_Month_ListsImportedAndManualTransactionsOfThatMonthNewestFirst()
    {
        await AddManualTransaction("2042-01-31", $"{_token} day before");
        await AddManualTransaction("2042-02-01", $"{_token} first day");
        await AddManualTransaction("2042-02-14", $"{_token} manual mid");
        await AddManualTransaction("2042-03-01", $"{_token} day after");
        // Imported after the manual one on the same date, so it has the higher id.
        await ImportStatement(
            "01.02.2042 - 28.02.2042",
            ("1402", $"{_token} imported mid"),
            ("2802", $"{_token} last day"));

        var transactions = await OwnTransactionsOf(2042, 2);

        Assert.Equal(
            [
                (new DateOnly(2042, 2, 28), $"{_token} last day", -10m, (int?)null),
                (new DateOnly(2042, 2, 14), $"{_token} imported mid", -10m, null),
                (new DateOnly(2042, 2, 14), $"{_token} manual mid", -249.90m, OtherCategoryId),
                (new DateOnly(2042, 2, 1), $"{_token} first day", -249.90m, OtherCategoryId),
            ],
            transactions.Select(t => (t.Date, t.Description, t.Amount, t.CategoryId)));
    }

    [Fact]
    public async Task Get_MonthWithoutTransactions_ReturnsEmptyList()
    {
        var transactions = await _client.GetFromJsonAsync<List<TransactionResponse>>(
            "/api/transactions?year=2043&month=7");

        Assert.Empty(transactions!);
    }

    [Theory]
    [InlineData("year=2026&month=0", "month")]
    [InlineData("year=2026&month=13", "month")]
    [InlineData("year=2026", "month")]
    [InlineData("year=1899&month=1", "year")]
    [InlineData("year=3000&month=1", "year")]
    [InlineData("month=1", "year")]
    public async Task Get_InvalidYearOrMonth_IsRejected(string query, string field)
    {
        var response = await _client.GetAsync($"/api/transactions?{query}");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        Assert.Contains(field, problem!.Errors.Keys);
    }
}
