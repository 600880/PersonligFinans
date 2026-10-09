using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc;
using PersonligFinans.Api.Spending;
using Xunit;

namespace PersonligFinans.Api.Tests;

[Collection(ApiCollection.Name)]
public class SpendingEndpointsTests
{
    private const int GroceriesCategoryId = 1;
    private const int RestaurantsCategoryId = 2;
    private const int ShoppingCategoryId = 8;
    private const int IncomeCategoryId = 11;
    private const int TransfersCategoryId = 12;

    private readonly HttpClient _client;

    // Spending adds up every Transaction of a month, so each test uses a year no other test uses.
    private readonly string _token = "t" + Guid.NewGuid().ToString("N")[..8];

    public SpendingEndpointsTests(PostgresApiFactory factory)
    {
        _client = factory.CreateClient();
    }

    private async Task AddManualTransaction(string date, decimal amount, int categoryId)
    {
        var response = await _client.PostAsJsonAsync(
            "/api/transactions",
            new { date, description = $"{_token} manual", amount, reference = (string?)null, categoryId });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    // Imports a Bank Statement with one Transaction of -10,00 per booked date (DDMM). No rule matches
    // the descriptions, so the imported Transactions are Uncategorized.
    private async Task ImportStatement(string period, params string[] bookedDates)
    {
        var digits = Random.Shared.NextInt64(0, 100_000_000_000).ToString("D11");
        var pdf = StatementPdf.Create(
            accountNumber: $"{digits[..4]}.{digits[4..6]}.{digits[6..]}",
            period,
            openingBalance: "1.000,00",
            rows: bookedDates.Select(d => new StatementPdfRow($"{_token} imported", d, "10,00", null, d, "21", "12345678")),
            closingBalance: $"{1000 - 10 * bookedDates.Length},00");
        var file = new ByteArrayContent(pdf);
        file.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
        using var form = new MultipartFormDataContent { { file, "file", "kontoutskrift.pdf" } };

        var response = await _client.PostAsync("/api/bank-statements", form);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    private async Task<SpendingResponse> SpendingOf(int year, int month, string extraQuery = "") =>
        (await _client.GetFromJsonAsync<SpendingResponse>($"/api/spending?year={year}&month={month}{extraQuery}"))!;

    [Fact]
    public async Task Get_Spending_SumsTheNegativeAmountsOfEachCategoryAsPositiveFiguresLargestFirst()
    {
        await AddManualTransaction("2051-03-02", -100m, GroceriesCategoryId);
        await AddManualTransaction("2051-03-15", -50.50m, GroceriesCategoryId);
        await AddManualTransaction("2051-03-10", -300m, RestaurantsCategoryId);
        await AddManualTransaction("2051-03-20", -20m, ShoppingCategoryId);

        var spending = await SpendingOf(2051, 3);

        Assert.Equal(
            [
                new SpendingSliceResponse(RestaurantsCategoryId, 300m),
                new SpendingSliceResponse(GroceriesCategoryId, 150.50m),
                new SpendingSliceResponse(ShoppingCategoryId, 20m),
            ],
            spending.Slices);
        Assert.Equal(470.50m, spending.Total);
    }

    [Fact]
    public async Task Get_Spending_IgnoresTransactionsInTheTransfersCategoryByDefault()
    {
        await AddManualTransaction("2052-05-03", -5000m, TransfersCategoryId);
        await AddManualTransaction("2052-05-04", -10m, GroceriesCategoryId);

        var spending = await SpendingOf(2052, 5);

        Assert.Equal([new SpendingSliceResponse(GroceriesCategoryId, 10m)], spending.Slices);
        Assert.Equal(10m, spending.Total);
    }

    [Fact]
    public async Task Get_SpendingIncludingTransfers_CountsNegativeTransfersAsTheirOwnSlice()
    {
        await AddManualTransaction("2061-05-03", -5000m, TransfersCategoryId);
        await AddManualTransaction("2061-05-04", 2000m, TransfersCategoryId);
        await AddManualTransaction("2061-05-05", -10m, GroceriesCategoryId);

        var spending = await SpendingOf(2061, 5, "&includeTransfers=true");

        Assert.Equal(
            [new SpendingSliceResponse(TransfersCategoryId, 5000m), new SpendingSliceResponse(GroceriesCategoryId, 10m)],
            spending.Slices);
        Assert.Equal(5010m, spending.Total);
    }

    [Fact]
    public async Task Get_SpendingExcludingTransfers_IgnoresTransactionsInTheTransfersCategory()
    {
        await AddManualTransaction("2062-05-03", -5000m, TransfersCategoryId);
        await AddManualTransaction("2062-05-04", -10m, GroceriesCategoryId);

        var spending = await SpendingOf(2062, 5, "&includeTransfers=false");

        Assert.Equal([new SpendingSliceResponse(GroceriesCategoryId, 10m)], spending.Slices);
        Assert.Equal(10m, spending.Total);
    }

    [Fact]
    public async Task Get_Spending_IsNotReducedByPositiveAmounts()
    {
        await AddManualTransaction("2053-04-02", -100m, GroceriesCategoryId);
        await AddManualTransaction("2053-04-09", 40m, GroceriesCategoryId);
        await AddManualTransaction("2053-04-25", 30000m, IncomeCategoryId);

        var spending = await SpendingOf(2053, 4);

        Assert.Equal([new SpendingSliceResponse(GroceriesCategoryId, 100m)], spending.Slices);
        Assert.Equal(100m, spending.Total);
    }

    [Fact]
    public async Task Get_Spending_CountsNegativeAmountsInIncome()
    {
        await AddManualTransaction("2054-08-12", -25m, IncomeCategoryId);

        var spending = await SpendingOf(2054, 8);

        Assert.Equal([new SpendingSliceResponse(IncomeCategoryId, 25m)], spending.Slices);
    }

    [Fact]
    public async Task Get_Spending_CountsImportedAndManualTransactions_WithUncategorizedAsItsOwnSlice()
    {
        await ImportStatement("01.06.2055 - 30.06.2055", "0306", "1706");
        await AddManualTransaction("2055-06-20", -5m, GroceriesCategoryId);

        var spending = await SpendingOf(2055, 6);

        Assert.Equal(
            [new SpendingSliceResponse(null, 20m), new SpendingSliceResponse(GroceriesCategoryId, 5m)],
            spending.Slices);
        Assert.Equal(25m, spending.Total);
    }

    [Fact]
    public async Task Get_Spending_IncludesTheFirstAndLastDayOfTheMonthButNotTheNeighbouringDays()
    {
        await AddManualTransaction("2056-01-31", -1m, GroceriesCategoryId);
        await AddManualTransaction("2056-02-01", -10m, GroceriesCategoryId);
        await AddManualTransaction("2056-02-29", -100m, GroceriesCategoryId);
        await AddManualTransaction("2056-03-01", -1000m, GroceriesCategoryId);

        var spending = await SpendingOf(2056, 2);

        Assert.Equal([new SpendingSliceResponse(GroceriesCategoryId, 110m)], spending.Slices);
    }

    [Fact]
    public async Task Get_Spending_OfMonthWithoutSpending_IsZeroWithNoSlices()
    {
        await AddManualTransaction("2057-07-25", 30000m, IncomeCategoryId);
        await AddManualTransaction("2057-07-26", -500m, TransfersCategoryId);

        var spending = await SpendingOf(2057, 7);

        Assert.Equal(0m, spending.Total);
        Assert.Empty(spending.Slices);
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
        var response = await _client.GetAsync($"/api/spending?{query}");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        Assert.Contains(field, problem!.Errors.Keys);
    }
}
