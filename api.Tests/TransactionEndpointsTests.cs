using System.Net;
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

    private readonly PostgresApiFactory _factory;
    private readonly HttpClient _client;

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

        Assert.Equal(13, categories!.Count);
        Assert.Contains(categories, c => c.Name == "Groceries");
        Assert.Contains(categories, c => c is { Id: OtherCategoryId, Name: "Other" });
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
}
