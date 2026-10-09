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
    private const int TravelId = 10;
    private const int TransfersId = 12;
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
        var created = await response.Content.ReadFromJsonAsync<SavedCategorizationRuleResponse>();
        Assert.Equal($"{_token} butikk", created!.Keyword);
        Assert.Equal(GroceriesId, created.CategoryId);
        Assert.Equal(0, created.TransactionsChanged);

        var rules = await _client.GetFromJsonAsync<List<CategorizationRuleResponse>>("/api/categorization-rules");
        Assert.Contains(new CategorizationRuleResponse(created.Id, $"{_token} butikk", GroceriesId, AiGenerated: false), rules!);
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

    [Fact]
    public async Task Get_FreshDatabase_ListsTheSeededRules()
    {
        var rules = await _client.GetFromJsonAsync<List<CategorizationRuleResponse>>("/api/categorization-rules");

        var categoryByKeyword = rules!.ToDictionary(r => r.Keyword, r => r.CategoryId);
        Assert.Equal(GroceriesId, categoryByKeyword["rema"]);
        Assert.Equal(TransfersId, categoryByKeyword["overføring mellom egne kontoer"]);
        Assert.Equal(TravelId, categoryByKeyword["widerøe"]);
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
        return (await response.Content.ReadFromJsonAsync<SavedCategorizationRuleResponse>())!.TransactionsChanged;
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
    public async Task Post_NoKeyword_IsRejected()
    {
        var errors = await AddRuleExpectingValidationErrors(null, GroceriesId);

        Assert.Equal(["keyword"], errors.Keys);
        Assert.Equal(["Keyword is required."], errors["keyword"]);
    }

    [Fact]
    public async Task Post_NoCategory_IsRejected()
    {
        var errors = await AddRuleExpectingValidationErrors($"{_token} butikk", null);

        Assert.Equal(["categoryId"], errors.Keys);
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

    private async Task<int> AddedRuleId(string keyword, int categoryId)
    {
        var response = await AddRule(keyword, categoryId);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<SavedCategorizationRuleResponse>())!.Id;
    }

    private async Task<HttpResponseMessage> EditRule(int id, string? keyword, int? categoryId) =>
        await _client.PutAsJsonAsync($"/api/categorization-rules/{id}", new { keyword, categoryId });

    private async Task<SavedCategorizationRuleResponse> EditedRule(int id, string keyword, int categoryId)
    {
        var response = await EditRule(id, keyword, categoryId);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<SavedCategorizationRuleResponse>())!;
    }

    [Fact]
    public async Task Put_CategoryChange_MovesTheRulesTransactions()
    {
        var ids = await Imported($"{_token} Butikk Sentrum", $"{_token} Butikk Nord", $"{_token} Annet");
        var ruleId = await AddedRuleId($"{_token} butikk", GroceriesId);

        var edited = await EditedRule(ruleId, $"{_token} butikk", RestaurantsId);

        Assert.Equal(new SavedCategorizationRuleResponse(ruleId, $"{_token} butikk", RestaurantsId, AiGenerated: false, 2), edited);
        Assert.Equal([RestaurantsId, RestaurantsId, null], await CategoriesOf(ids));
        var rules = await _client.GetFromJsonAsync<List<CategorizationRuleResponse>>("/api/categorization-rules");
        Assert.Contains(new CategorizationRuleResponse(ruleId, $"{_token} butikk", RestaurantsId, AiGenerated: false), rules!);
    }

    [Fact]
    public async Task Put_KeywordChange_ReleasesTransactionsAndPicksUpNewOnes()
    {
        var ids = await Imported($"{_token} Butikk {_token} Sentrum", $"{_token} Butikk Nord", $"{_token} Bakeri");
        await AddedRuleId($"{_token} sent", OtherId);
        var ruleId = await AddedRuleId($"{_token} butikk", GroceriesId);

        var edited = await EditedRule(ruleId, $"{_token} bakeri", GroceriesId);

        Assert.Equal(3, edited.TransactionsChanged);
        Assert.Equal([OtherId, null, GroceriesId], await CategoriesOf(ids));
    }

    [Fact]
    public async Task Put_OnlyTheKeywordsCase_IsAllowedAndChangesNoTransactions()
    {
        var ids = await Imported($"{_token} Butikk Sentrum");
        var ruleId = await AddedRuleId($"{_token} butikk", GroceriesId);

        var edited = await EditedRule(ruleId, $" {_token.ToUpperInvariant()} BUTIKK ", GroceriesId);

        Assert.Equal(
            new SavedCategorizationRuleResponse(ruleId, $"{_token.ToUpperInvariant()} BUTIKK", GroceriesId, AiGenerated: false, 0),
            edited);
        Assert.Equal([GroceriesId], await CategoriesOf(ids));
    }

    [Fact]
    public async Task Put_KeywordOfAnotherRule_IsRejected()
    {
        await AddedRuleId($"{_token} kafé", RestaurantsId);
        var ruleId = await AddedRuleId($"{_token} butikk", GroceriesId);

        var response = await EditRule(ruleId, $"{_token.ToUpperInvariant()} KAFÉ", GroceriesId);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        Assert.Equal([$"A rule for '{_token} kafé' already exists."], problem!.Errors["keyword"]);
    }

    [Fact]
    public async Task Put_InvalidRequest_IsRejectedWithErrorPerField()
    {
        var ruleId = await AddedRuleId($"{_token} butikk", GroceriesId);

        var response = await EditRule(ruleId, " x ", 9999);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        Assert.Equal(["Keyword must be at least 2 characters."], problem!.Errors["keyword"]);
        Assert.Equal(["Category does not exist."], problem.Errors["categoryId"]);
    }

    [Fact]
    public async Task Put_UnknownRule_ReturnsNotFound()
    {
        var response = await EditRule(int.MaxValue, $"{_token} butikk", GroceriesId);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // The rule endpoints never set the mark, so the tests set it directly in the database.
    private async Task MarkAiGenerated(int ruleId)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var rule = await db.CategorizationRules.SingleAsync(r => r.Id == ruleId);
        rule.AiGenerated = true;
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task Get_AiGeneratedRule_IsReportedAsAiGenerated()
    {
        var aiRuleId = await AddedRuleId($"{_token} kafé", RestaurantsId);
        var handAddedRuleId = await AddedRuleId($"{_token} butikk", GroceriesId);
        await MarkAiGenerated(aiRuleId);

        var rules = await _client.GetFromJsonAsync<List<CategorizationRuleResponse>>("/api/categorization-rules");

        Assert.Contains(new CategorizationRuleResponse(aiRuleId, $"{_token} kafé", RestaurantsId, AiGenerated: true), rules!);
        Assert.Contains(new CategorizationRuleResponse(handAddedRuleId, $"{_token} butikk", GroceriesId, AiGenerated: false), rules!);
    }

    [Fact]
    public async Task Get_FreshDatabase_SeededRulesAreNotAiGenerated()
    {
        var rules = await _client.GetFromJsonAsync<List<CategorizationRuleResponse>>("/api/categorization-rules");

        Assert.False(rules!.Single(r => r.Keyword == "rema").AiGenerated);
    }

    [Fact]
    public async Task Post_RuleClaimingToBeAiGenerated_IsNotAiGenerated()
    {
        var response = await _client.PostAsJsonAsync(
            "/api/categorization-rules",
            new { keyword = $"{_token} butikk", categoryId = GroceriesId, aiGenerated = true });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<SavedCategorizationRuleResponse>();
        Assert.False(created!.AiGenerated);
        var rules = await _client.GetFromJsonAsync<List<CategorizationRuleResponse>>("/api/categorization-rules");
        Assert.False(rules!.Single(r => r.Id == created.Id).AiGenerated);
    }

    [Fact]
    public async Task Put_AiGeneratedRule_LosesTheMarkWhenItsKeywordAndCategoryChange()
    {
        var ruleId = await AddedRuleId($"{_token} kafé", RestaurantsId);
        await MarkAiGenerated(ruleId);

        var edited = await EditedRule(ruleId, $"{_token} bakeri", GroceriesId);

        Assert.False(edited.AiGenerated);
        var rules = await _client.GetFromJsonAsync<List<CategorizationRuleResponse>>("/api/categorization-rules");
        Assert.Contains(new CategorizationRuleResponse(ruleId, $"{_token} bakeri", GroceriesId, AiGenerated: false), rules!);
    }

    [Fact]
    public async Task Put_AiGeneratedRuleSavedUnchanged_LosesTheMark()
    {
        var ruleId = await AddedRuleId($"{_token} kafé", RestaurantsId);
        await MarkAiGenerated(ruleId);

        var edited = await EditedRule(ruleId, $"{_token} kafé", RestaurantsId);

        Assert.Equal(new SavedCategorizationRuleResponse(ruleId, $"{_token} kafé", RestaurantsId, AiGenerated: false, 0), edited);
        var rules = await _client.GetFromJsonAsync<List<CategorizationRuleResponse>>("/api/categorization-rules");
        Assert.Contains(new CategorizationRuleResponse(ruleId, $"{_token} kafé", RestaurantsId, AiGenerated: false), rules!);
    }

    [Fact]
    public async Task Put_RequestClaimingAiGenerated_LeavesAHandAddedRuleUnmarked()
    {
        var ruleId = await AddedRuleId($"{_token} butikk", GroceriesId);

        var response = await _client.PutAsJsonAsync(
            $"/api/categorization-rules/{ruleId}",
            new { keyword = $"{_token} butikk", categoryId = RestaurantsId, aiGenerated = true });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var edited = await response.Content.ReadFromJsonAsync<SavedCategorizationRuleResponse>();
        Assert.False(edited!.AiGenerated);
    }

    private async Task<int> TransactionsChangedByDeleting(int ruleId)
    {
        var response = await _client.DeleteAsync($"/api/categorization-rules/{ruleId}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<DeletedCategorizationRuleResponse>())!.TransactionsChanged;
    }

    [Fact]
    public async Task Delete_Rule_HandsItsTransactionsToTheNextBestRuleOrLeavesThemUncategorized()
    {
        var ids = await Imported($"{_token} Butikk {_token} Sentrum", $"{_token} Butikk Nord", $"{_token} Annet");
        await AddedRuleId($"{_token} sent", OtherId);
        var ruleId = await AddedRuleId($"{_token} butikk", GroceriesId);

        var changed = await TransactionsChangedByDeleting(ruleId);

        Assert.Equal(2, changed);
        Assert.Equal([OtherId, null, null], await CategoriesOf(ids));
        var rules = await _client.GetFromJsonAsync<List<CategorizationRuleResponse>>("/api/categorization-rules");
        Assert.DoesNotContain(rules!, r => r.Id == ruleId);
    }

    [Fact]
    public async Task Delete_UnknownRule_ReturnsNotFound()
    {
        var response = await _client.DeleteAsync($"/api/categorization-rules/{int.MaxValue}");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task EditAndDelete_NeverChangeManuallyEnteredTransactions()
    {
        var response = await _client.PostAsJsonAsync("/api/transactions", new
        {
            date = "2026-08-03",
            description = $"{_token} Butikk",
            amount = -100m,
            categoryId = OtherId,
        });
        var manual = await response.Content.ReadFromJsonAsync<TransactionResponse>();
        var ruleId = await AddedRuleId($"{_token} butikk", GroceriesId);

        var edited = await EditedRule(ruleId, $"{_token} butikk", RestaurantsId);
        var deleted = await TransactionsChangedByDeleting(ruleId);

        Assert.Equal(0, edited.TransactionsChanged);
        Assert.Equal(0, deleted);
        Assert.Equal([OtherId], await CategoriesOf(manual!.Id));
    }
}
