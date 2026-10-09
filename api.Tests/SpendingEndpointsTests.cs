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

    // includeTransfers is left out of the request when null.
    private Task<SpendingResponse> SpendingOf(int year, int month, bool? includeTransfers = null) =>
        SpendingOf($"year={year}&month={month}" + (includeTransfers is { } include ? $"&includeTransfers={include}" : ""));

    private async Task<SpendingResponse> SpendingOf(string query) =>
        (await _client.GetFromJsonAsync<SpendingResponse>($"/api/spending?{query}"))!;

    // The Span runs from the month (fromYear, fromMonth) to the month (toYear, toMonth), both included.
    // includeTransfers is left out of the request when null.
    private async Task<List<MonthlySpendingResponse>> MonthlySpendingOf(
        int fromYear, int fromMonth, int toYear, int toMonth, bool? includeTransfers = null) =>
        (await _client.GetFromJsonAsync<List<MonthlySpendingResponse>>(
            $"/api/spending/monthly?fromYear={fromYear}&fromMonth={fromMonth}&toYear={toYear}&toMonth={toMonth}"
            + (includeTransfers is { } include ? $"&includeTransfers={include}" : "")))!;

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
    public async Task Get_SpendingIncludingTransfers_CountsNegativeAmountsInTheTransfersCategoryAsTheirOwnSlice()
    {
        await AddManualTransaction("2061-05-03", -5000m, TransfersCategoryId);
        await AddManualTransaction("2061-05-04", 2000m, TransfersCategoryId);
        await AddManualTransaction("2061-05-05", -10m, GroceriesCategoryId);

        var spending = await SpendingOf(2061, 5, includeTransfers: true);

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

        var spending = await SpendingOf(2062, 5, includeTransfers: false);

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

    [Fact]
    public async Task Get_SpendingOfQuarter_RunsFromTheFirstDayOfItsFirstMonthToTheLastDayOfItsThird()
    {
        await AddManualTransaction("2071-03-31", -1m, GroceriesCategoryId);
        await AddManualTransaction("2071-04-01", -10m, GroceriesCategoryId);
        await AddManualTransaction("2071-05-15", -100m, GroceriesCategoryId);
        await AddManualTransaction("2071-06-30", -1000m, GroceriesCategoryId);
        await AddManualTransaction("2071-07-01", -10000m, GroceriesCategoryId);

        var q1 = await SpendingOf("year=2071&quarter=1");
        var q2 = await SpendingOf("year=2071&quarter=2");

        Assert.Equal([new SpendingSliceResponse(GroceriesCategoryId, 1m)], q1.Slices);
        Assert.Equal([new SpendingSliceResponse(GroceriesCategoryId, 1110m)], q2.Slices);
        Assert.Equal(1110m, q2.Total);
    }

    [Fact]
    public async Task Get_SpendingOfYear_RunsFromTheFirstOfJanuaryToTheThirtyFirstOfDecember()
    {
        await AddManualTransaction("2072-12-31", -1m, GroceriesCategoryId);
        await AddManualTransaction("2073-01-01", -10m, GroceriesCategoryId);
        await AddManualTransaction("2073-06-15", -100m, RestaurantsCategoryId);
        await AddManualTransaction("2073-12-31", -1000m, GroceriesCategoryId);
        await AddManualTransaction("2074-01-01", -10000m, GroceriesCategoryId);

        var spending = await SpendingOf("year=2073");

        Assert.Equal(
            [
                new SpendingSliceResponse(GroceriesCategoryId, 1010m),
                new SpendingSliceResponse(RestaurantsCategoryId, 100m),
            ],
            spending.Slices);
        Assert.Equal(1110m, spending.Total);
    }

    [Theory]
    [InlineData("year=2026&quarter=0", "quarter")]
    [InlineData("year=2026&quarter=5", "quarter")]
    [InlineData("year=2026&quarter=1&month=1", "quarter")]
    [InlineData("year=1899&quarter=1", "year")]
    [InlineData("year=3000", "year")]
    [InlineData("quarter=1", "year")]
    public async Task Get_InvalidQuarterOrYear_IsRejected(string query, string field)
    {
        var response = await _client.GetAsync($"/api/spending?{query}");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        Assert.Contains(field, problem!.Errors.Keys);
    }

    [Theory]
    [InlineData("year=2026&month=0", "month")]
    [InlineData("year=2026&month=13", "month")]
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

    [Fact]
    public async Task Get_MonthlySpending_HasOneEntryPerMonthOfTheSpanInOrder_WithEmptyMonthsAsNoSlices()
    {
        await AddManualTransaction("2081-11-10", -100m, GroceriesCategoryId);
        await AddManualTransaction("2082-02-10", -40m, RestaurantsCategoryId);

        var monthly = await MonthlySpendingOf(2081, 11, 2082, 2);

        Assert.Equal(
            [(2081, 11), (2081, 12), (2082, 1), (2082, 2)],
            monthly.Select(m => (m.Year, m.Month)));
        Assert.Equal([new SpendingSliceResponse(GroceriesCategoryId, 100m)], monthly[0].Slices);
        Assert.Empty(monthly[1].Slices);
        Assert.Empty(monthly[2].Slices);
        Assert.Equal([new SpendingSliceResponse(RestaurantsCategoryId, 40m)], monthly[3].Slices);
    }

    [Fact]
    public async Task Get_MonthlySpending_IncludesTheFirstAndLastDayOfTheSpanButNotTheNeighbouringDays()
    {
        await AddManualTransaction("2083-02-28", -1m, GroceriesCategoryId);
        await AddManualTransaction("2083-03-01", -10m, GroceriesCategoryId);
        await AddManualTransaction("2083-03-31", -100m, GroceriesCategoryId);
        await AddManualTransaction("2083-04-01", -1000m, GroceriesCategoryId);
        await AddManualTransaction("2083-04-30", -10000m, GroceriesCategoryId);
        await AddManualTransaction("2083-05-01", -100000m, GroceriesCategoryId);

        var monthly = await MonthlySpendingOf(2083, 3, 2083, 4);

        Assert.Equal([new SpendingSliceResponse(GroceriesCategoryId, 110m)], monthly[0].Slices);
        Assert.Equal([new SpendingSliceResponse(GroceriesCategoryId, 11000m)], monthly[1].Slices);
    }

    [Fact]
    public async Task Get_MonthlySpending_SumsTheNegativeAmountsOfEachCategoryAsPositiveFigures_NotReducedByRefunds()
    {
        await AddManualTransaction("2084-06-02", -100m, GroceriesCategoryId);
        await AddManualTransaction("2084-06-15", -50.50m, GroceriesCategoryId);
        await AddManualTransaction("2084-06-16", 40m, GroceriesCategoryId);
        await AddManualTransaction("2084-06-10", -300m, RestaurantsCategoryId);
        await AddManualTransaction("2084-06-25", 30000m, IncomeCategoryId);
        await AddManualTransaction("2084-07-03", 25m, ShoppingCategoryId);

        var monthly = await MonthlySpendingOf(2084, 6, 2084, 7);

        Assert.Equal(
            [
                new SpendingSliceResponse(RestaurantsCategoryId, 300m),
                new SpendingSliceResponse(GroceriesCategoryId, 150.50m),
            ],
            monthly[0].Slices);
        Assert.Empty(monthly[1].Slices);
    }

    [Fact]
    public async Task Get_MonthlySpending_CountsImportedAndManualTransactions_WithUncategorizedAsItsOwnSlice()
    {
        await ImportStatement("01.08.2085 - 30.09.2085", "0308", "1708", "0209");
        await AddManualTransaction("2085-08-20", -5m, GroceriesCategoryId);

        var monthly = await MonthlySpendingOf(2085, 8, 2085, 9);

        Assert.Equal(
            [new SpendingSliceResponse(null, 20m), new SpendingSliceResponse(GroceriesCategoryId, 5m)],
            monthly[0].Slices);
        Assert.Equal([new SpendingSliceResponse(null, 10m)], monthly[1].Slices);
    }

    [Fact]
    public async Task Get_MonthlySpending_IgnoresTransactionsInTheTransfersCategoryByDefault()
    {
        await AddManualTransaction("2086-05-03", -5000m, TransfersCategoryId);
        await AddManualTransaction("2086-05-04", -10m, GroceriesCategoryId);
        await AddManualTransaction("2086-06-03", -700m, TransfersCategoryId);

        var byDefault = await MonthlySpendingOf(2086, 5, 2086, 6);
        var excludingTransfers = await MonthlySpendingOf(2086, 5, 2086, 6, includeTransfers: false);

        foreach (var monthly in new[] { byDefault, excludingTransfers })
        {
            Assert.Equal([new SpendingSliceResponse(GroceriesCategoryId, 10m)], monthly[0].Slices);
            Assert.Empty(monthly[1].Slices);
        }
    }

    [Fact]
    public async Task Get_MonthlySpendingIncludingTransfers_CountsNegativeAmountsInTheTransfersCategoryAsTheirOwnSlice()
    {
        await AddManualTransaction("2087-05-03", -5000m, TransfersCategoryId);
        await AddManualTransaction("2087-05-04", 2000m, TransfersCategoryId);
        await AddManualTransaction("2087-05-05", -10m, GroceriesCategoryId);
        await AddManualTransaction("2087-06-03", -700m, TransfersCategoryId);

        var monthly = await MonthlySpendingOf(2087, 5, 2087, 6, includeTransfers: true);

        Assert.Equal(
            [new SpendingSliceResponse(TransfersCategoryId, 5000m), new SpendingSliceResponse(GroceriesCategoryId, 10m)],
            monthly[0].Slices);
        Assert.Equal([new SpendingSliceResponse(TransfersCategoryId, 700m)], monthly[1].Slices);
    }

    [Theory]
    [InlineData("fromYear=2026&fromMonth=0&toYear=2026&toMonth=6", "fromMonth")]
    [InlineData("fromYear=2026&fromMonth=1&toYear=2026&toMonth=13", "toMonth")]
    [InlineData("fromYear=1899&fromMonth=1&toYear=2026&toMonth=6", "fromYear")]
    [InlineData("fromYear=2026&fromMonth=1&toYear=3000&toMonth=6", "toYear")]
    [InlineData("fromMonth=1&toYear=2026&toMonth=6", "fromYear")]
    [InlineData("fromYear=2026&toYear=2026&toMonth=6", "fromMonth")]
    [InlineData("fromYear=2026&fromMonth=1&toMonth=6", "toYear")]
    [InlineData("fromYear=2026&fromMonth=1&toYear=2026", "toMonth")]
    [InlineData("fromYear=2026&fromMonth=6&toYear=2026&toMonth=6", "toMonth")]
    [InlineData("fromYear=2026&fromMonth=6&toYear=2026&toMonth=5", "toMonth")]
    [InlineData("fromYear=2026&fromMonth=1&toYear=2025&toMonth=12", "toMonth")]
    public async Task Get_MonthlySpendingOfInvalidSpan_IsRejected(string query, string field)
    {
        var response = await _client.GetAsync($"/api/spending/monthly?{query}");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        Assert.Contains(field, problem!.Errors.Keys);
    }
}
