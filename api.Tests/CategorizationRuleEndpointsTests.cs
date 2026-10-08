using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PersonligFinans.Api.CategorizationRules;
using PersonligFinans.Api.Data;
using PersonligFinans.Api.Transactions;

namespace PersonligFinans.Api.Tests;

[Collection(ApiCollection.Name)]
public class CategorizationRuleEndpointsTests
{
    private const int GroceriesId = 1;
    private const int RestaurantsId = 2;
    private const int OtherId = 13;

    private readonly PostgresApiFactory _factory;
    private readonly HttpClient _client;

    // The tests share one database, so each test's keywords and descriptions contain a token of
    // its own; otherwise one test's rules would re-match another test's Transactions.
    private readonly string _token = "t" + Guid.NewGuid().ToString("N")[..8];

    public CategorizationRuleEndpointsTests(PostgresApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    private async Task<HttpResponseMessage> AddRule(string keyword, int? categoryId) =>
        await _client.PostAsJsonAsync("/api/categorization-rules", new { keyword, categoryId });

    [Fact]
    public async Task Post_ValidRule_IsCreatedAndListed()
    {
        var response = await AddRule($"{_token} butikk", GroceriesId);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<CreatedCategorizationRuleResponse>();
        Assert.Equal($"{_token} butikk", created!.Keyword);
        Assert.Equal(GroceriesId, created.CategoryId);
        Assert.Equal(0, created.TransactionsChanged);

        var rules = await _client.GetFromJsonAsync<List<CategorizationRuleResponse>>("/api/categorization-rules");
        Assert.Contains(new CategorizationRuleResponse(created.Id, $"{_token} butikk", GroceriesId), rules!);
    }

    [Fact]
    public async Task Get_ListsRulesSortedByKeyword()
    {
        await AddRule($"{_token} b", GroceriesId);
        await AddRule($"{_token} a", GroceriesId);

        var rules = await _client.GetFromJsonAsync<List<CategorizationRuleResponse>>("/api/categorization-rules");

        Assert.Equal(
            [$"{_token} a", $"{_token} b"],
            rules!.Select(r => r.Keyword).Where(k => k.StartsWith(_token)));
    }

    // Stores Transactions as if imported from a Bank Statement, all Uncategorized.
    private async Task<int[]> Imported(params string[] descriptions)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var statement = new BankStatement
        {
            AccountNumber = Guid.NewGuid().ToString("N")[..AppDbContext.AccountNumberMaxLength],
            PeriodStart = new DateOnly(2026, 8, 1),
            PeriodEnd = new DateOnly(2026, 8, 31),
            ImportedAt = DateTimeOffset.UtcNow,
        };
        var transactions = descriptions
            .Select(d => new Transaction { PostedDate = new DateOnly(2026, 8, 3), Description = d, Amount = -100m })
            .ToList();
        statement.Transactions.AddRange(transactions);
        db.BankStatements.Add(statement);
        await db.SaveChangesAsync();
        return transactions.Select(t => t.Id).ToArray();
    }

    private async Task<int?[]> CategoriesOf(params int[] transactionIds)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var categories = await db.Transactions
            .Where(t => transactionIds.Contains(t.Id))
            .ToDictionaryAsync(t => t.Id, t => t.CategoryId);
        return transactionIds.Select(id => categories[id]).ToArray();
    }

    private async Task<int> TransactionsChangedByAdding(string keyword, int categoryId)
    {
        var response = await AddRule(keyword, categoryId);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<CreatedCategorizationRuleResponse>())!.TransactionsChanged;
    }

    [Fact]
    public async Task Post_Rule_CategorizesMatchingUncategorizedImportedTransactions()
    {
        var ids = await Imported($"{_token} Butikk Sentrum", $"Kafé {_token} Butikk", $"{_token} Annet");

        var changed = await TransactionsChangedByAdding($"{_token} butikk", GroceriesId);

        Assert.Equal(2, changed);
        Assert.Equal([GroceriesId, GroceriesId, null], await CategoriesOf(ids));
    }

    [Fact]
    public async Task Post_LongerRule_TakesOverTransactionsFromShorterRule()
    {
        var ids = await Imported($"{_token} Butikk Kafé", $"{_token} Butikk");
        await TransactionsChangedByAdding($"{_token} butikk", GroceriesId);

        var changed = await TransactionsChangedByAdding($"{_token} butikk kafé", RestaurantsId);

        Assert.Equal(1, changed);
        Assert.Equal([RestaurantsId, GroceriesId], await CategoriesOf(ids));
    }

    [Fact]
    public async Task Post_EquallyLongKeywords_OldestRuleWins()
    {
        var ids = await Imported($"{_token} aaaa {_token} bbbb");
        await TransactionsChangedByAdding($"{_token} bbbb", GroceriesId);

        var changed = await TransactionsChangedByAdding($"{_token} aaaa", RestaurantsId);

        Assert.Equal(0, changed);
        Assert.Equal([GroceriesId], await CategoriesOf(ids));
    }

    [Fact]
    public async Task Post_Rule_MatchesIgnoringCaseIncludingNorwegianLetters()
    {
        var ids = await Imported($"{_token.ToUpperInvariant()} ØLSTUE BRYGGEN");

        await TransactionsChangedByAdding($"{_token} ølstue", RestaurantsId);

        Assert.Equal([RestaurantsId], await CategoriesOf(ids));
    }

    [Fact]
    public async Task Post_Rule_NeverChangesManuallyEnteredTransactions()
    {
        var response = await _client.PostAsJsonAsync("/api/transactions", new
        {
            date = "2026-08-03",
            description = $"{_token} Butikk",
            amount = -100m,
            categoryId = OtherId,
        });
        var manual = await response.Content.ReadFromJsonAsync<TransactionResponse>();

        var changed = await TransactionsChangedByAdding($"{_token} butikk", GroceriesId);

        Assert.Equal(0, changed);
        Assert.Equal([OtherId], await CategoriesOf(manual!.Id));
    }

    private async Task<Dictionary<string, string[]>> AddRuleExpectingValidationErrors(string? keyword, int? categoryId)
    {
        var response = await AddRule(keyword, categoryId);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        return new Dictionary<string, string[]>(problem!.Errors);
    }

    [Fact]
    public async Task Post_MissingKeywordAndCategory_ReturnsErrorPerField()
    {
        var errors = await AddRuleExpectingValidationErrors("   ", null);

        Assert.Equal(["Keyword is required."], errors["keyword"]);
        Assert.Equal(["Category is required."], errors["categoryId"]);
    }

    [Fact]
    public async Task Post_KeywordShorterThanTwoCharactersAfterTrimming_IsRejected()
    {
        var errors = await AddRuleExpectingValidationErrors(" x ", GroceriesId);

        Assert.Equal(["Keyword must be at least 2 characters."], errors["keyword"]);
    }

    [Fact]
    public async Task Post_KeywordLongerThanOneHundredCharacters_IsRejected()
    {
        var errors = await AddRuleExpectingValidationErrors(new string('x', 101), GroceriesId);

        Assert.Equal(["Keyword must be at most 100 characters."], errors["keyword"]);
    }

    [Fact]
    public async Task Post_KeywordThatExistsIgnoringCase_IsRejected()
    {
        Assert.Equal(HttpStatusCode.Created, (await AddRule($"{_token} kafé", GroceriesId)).StatusCode);

        var errors = await AddRuleExpectingValidationErrors($"  {_token.ToUpperInvariant()} KAFÉ ", GroceriesId);

        Assert.Equal([$"A rule for '{_token} kafé' already exists."], errors["keyword"]);
    }

    [Fact]
    public async Task Post_UnknownCategory_IsRejected()
    {
        var errors = await AddRuleExpectingValidationErrors($"{_token} butikk", 9999);

        Assert.Equal(["Category does not exist."], errors["categoryId"]);
    }
}
