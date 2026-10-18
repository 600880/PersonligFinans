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
public class CategorizationRuleEndpointsTests : IAsyncLifetime
{
    private readonly PostgresApiFactory _factory;
    private readonly string _email = SignedInClient.UniqueEmail();
    private HttpClient _client = null!;
    private SeededCategories _seeded = null!;

    public CategorizationRuleEndpointsTests(PostgresApiFactory factory)
    {
        _factory = factory;
    }

    public async Task InitializeAsync()
    {
        _client = await _factory.CreateSignedInClientAsync(_email);
        _seeded = await SeededCategories.Of(_client);
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<HttpResponseMessage> AddRule(string keyword, int? categoryId) =>
        await _client.PostAsJsonAsync("/api/categorization-rules", new { keyword, categoryId });

    [Fact]
    public async Task Post_ValidRule_IsCreatedAndListed()
    {
        var response = await AddRule("butikk", _seeded.Groceries);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<SavedCategorizationRuleResponse>();
        Assert.Equal("butikk", created!.Keyword);
        Assert.Equal(_seeded.Groceries, created.CategoryId);
        Assert.Equal(0, created.TransactionsChanged);

        var rules = await _client.GetFromJsonAsync<List<CategorizationRuleResponse>>("/api/categorization-rules");
        Assert.Contains(new CategorizationRuleResponse(created.Id, "butikk", _seeded.Groceries, AiGenerated: false, IsNew: false), rules!);
    }

    [Fact]
    public async Task Get_ListsRulesSortedByKeyword()
    {
        await AddRule("butikk b", _seeded.Groceries);
        await AddRule("butikk a", _seeded.Groceries);

        var rules = await _client.GetFromJsonAsync<List<CategorizationRuleResponse>>("/api/categorization-rules");

        Assert.Equal(
            ["butikk a", "butikk b"],
            rules!.Select(r => r.Keyword).Where(k => k.StartsWith("butikk")));
    }

    [Fact]
    public async Task Get_FreshDatabase_ListsTheSeededRules()
    {
        var rules = await _client.GetFromJsonAsync<List<CategorizationRuleResponse>>("/api/categorization-rules");

        var categoryByKeyword = rules!.ToDictionary(r => r.Keyword, r => r.CategoryId);
        Assert.Equal(_seeded.Groceries, categoryByKeyword["rema"]);
        Assert.Equal(_seeded.Transfers, categoryByKeyword["overføring mellom egne kontoer"]);
        Assert.Equal(_seeded.Travel, categoryByKeyword["widerøe"]);
    }

    [Fact]
    public async Task Get_FreshDatabase_ListsTheSeededClothingAndElectronicsRules()
    {
        var rules = await _client.GetFromJsonAsync<List<CategorizationRuleResponse>>("/api/categorization-rules");

        var categoryByKeyword = rules!.ToDictionary(r => r.Keyword, r => r.CategoryId);
        Assert.All(
            ["zalando", "cubus", "dressmann", "lindex", "bik bok", "carlings", "kappahl", "h&m"],
            keyword => Assert.Equal(_seeded.Clothing, categoryByKeyword[keyword]));
        Assert.All(
            ["elkjøp", "komplett", "proshop", "netonnet"],
            keyword => Assert.Equal(_seeded.Electronics, categoryByKeyword[keyword]));
        Assert.Equal(_seeded.Shopping, categoryByKeyword["xxl"]);
        Assert.False(rules!.Single(r => r.Keyword == "cubus").AiGenerated);
    }

    // Stores Transactions as if imported from a Bank Statement, all Uncategorized.
    private async Task<int[]> Imported(params string[] descriptions)
    {
        await using var user = await UserDatabase.OfAsync(_factory, _email);
        var db = user.Db;
        var statement = new BankStatement
        {
            UserId = db.CurrentUserId,
            AccountNumber = Guid.NewGuid().ToString("N")[..AppDbContext.AccountNumberMaxLength],
            PeriodStart = new DateOnly(2026, 8, 1),
            PeriodEnd = new DateOnly(2026, 8, 31),
            ImportedAt = DateTimeOffset.UtcNow,
        };
        var transactions = descriptions
            .Select(d => new Transaction { UserId = db.CurrentUserId, PostedDate = new DateOnly(2026, 8, 3), Description = d, Amount = -100m })
            .ToList();
        statement.Transactions.AddRange(transactions);
        db.BankStatements.Add(statement);
        await db.SaveChangesAsync();
        return transactions.Select(t => t.Id).ToArray();
    }

    private async Task<int?[]> CategoriesOf(params int[] transactionIds)
    {
        await using var user = await UserDatabase.OfAsync(_factory, _email);
        var db = user.Db;
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
        var ids = await Imported("Butikk Sentrum", "Kafé Butikk", "Annet");

        var changed = await TransactionsChangedByAdding("butikk", _seeded.Groceries);

        Assert.Equal(2, changed);
        Assert.Equal([_seeded.Groceries, _seeded.Groceries, null], await CategoriesOf(ids));
    }

    [Fact]
    public async Task Post_LongerRule_TakesOverTransactionsFromShorterRule()
    {
        var ids = await Imported("Butikk Kafé", "Butikk");
        await TransactionsChangedByAdding("butikk", _seeded.Groceries);

        var changed = await TransactionsChangedByAdding("butikk kafé", _seeded.Restaurants);

        Assert.Equal(1, changed);
        Assert.Equal([_seeded.Restaurants, _seeded.Groceries], await CategoriesOf(ids));
    }

    [Fact]
    public async Task Post_EquallyLongKeywords_OldestRuleWins()
    {
        var ids = await Imported("aaaa bbbb");
        await TransactionsChangedByAdding("bbbb", _seeded.Groceries);

        var changed = await TransactionsChangedByAdding("aaaa", _seeded.Restaurants);

        Assert.Equal(0, changed);
        Assert.Equal([_seeded.Groceries], await CategoriesOf(ids));
    }

    [Fact]
    public async Task Post_Rule_MatchesIgnoringCaseIncludingNorwegianLetters()
    {
        var ids = await Imported("ØLSTUE BRYGGEN");

        await TransactionsChangedByAdding("ølstue", _seeded.Restaurants);

        Assert.Equal([_seeded.Restaurants], await CategoriesOf(ids));
    }

    [Fact]
    public async Task Post_Rule_NeverChangesManuallyEnteredTransactions()
    {
        var response = await _client.PostAsJsonAsync("/api/transactions", new
        {
            date = "2026-08-03",
            description = "Butikk",
            amount = -100m,
            categoryId = _seeded.Other,
        });
        var manual = await response.Content.ReadFromJsonAsync<TransactionResponse>();

        var changed = await TransactionsChangedByAdding("butikk", _seeded.Groceries);

        Assert.Equal(0, changed);
        Assert.Equal([_seeded.Other], await CategoriesOf(manual!.Id));
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
        var errors = await AddRuleExpectingValidationErrors(null, _seeded.Groceries);

        Assert.Equal(["keyword"], errors.Keys);
        Assert.Equal(["Keyword is required."], errors["keyword"]);
    }

    [Fact]
    public async Task Post_NoCategory_IsRejected()
    {
        var errors = await AddRuleExpectingValidationErrors("butikk", null);

        Assert.Equal(["categoryId"], errors.Keys);
        Assert.Equal(["Category is required."], errors["categoryId"]);
    }

    [Fact]
    public async Task Post_KeywordShorterThanTwoCharactersAfterTrimming_IsRejected()
    {
        var errors = await AddRuleExpectingValidationErrors(" x ", _seeded.Groceries);

        Assert.Equal(["Keyword must be at least 2 characters."], errors["keyword"]);
    }

    [Fact]
    public async Task Post_KeywordLongerThanOneHundredCharacters_IsRejected()
    {
        var errors = await AddRuleExpectingValidationErrors(new string('x', 101), _seeded.Groceries);

        Assert.Equal(["Keyword must be at most 100 characters."], errors["keyword"]);
    }

    [Fact]
    public async Task Post_KeywordThatExistsIgnoringCase_IsRejected()
    {
        Assert.Equal(HttpStatusCode.Created, (await AddRule("kafé", _seeded.Groceries)).StatusCode);

        var errors = await AddRuleExpectingValidationErrors("  KAFÉ ", _seeded.Groceries);

        Assert.Equal(["A rule for 'kafé' already exists."], errors["keyword"]);
    }

    [Fact]
    public async Task Post_UnknownCategory_IsRejected()
    {
        var errors = await AddRuleExpectingValidationErrors("butikk", 9999);

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
        var ids = await Imported("Butikk Sentrum", "Butikk Nord", "Annet");
        var ruleId = await AddedRuleId("butikk", _seeded.Groceries);

        var edited = await EditedRule(ruleId, "butikk", _seeded.Restaurants);

        Assert.Equal(new SavedCategorizationRuleResponse(ruleId, "butikk", _seeded.Restaurants, AiGenerated: false, IsNew: false, 2), edited);
        Assert.Equal([_seeded.Restaurants, _seeded.Restaurants, null], await CategoriesOf(ids));
        var rules = await _client.GetFromJsonAsync<List<CategorizationRuleResponse>>("/api/categorization-rules");
        Assert.Contains(new CategorizationRuleResponse(ruleId, "butikk", _seeded.Restaurants, AiGenerated: false, IsNew: false), rules!);
    }

    [Fact]
    public async Task Put_KeywordChange_ReleasesTransactionsAndPicksUpNewOnes()
    {
        var ids = await Imported("Butikk Sentrum", "Butikk Nord", "Bakeri");
        await AddedRuleId("sent", _seeded.Other);
        var ruleId = await AddedRuleId("butikk", _seeded.Groceries);

        var edited = await EditedRule(ruleId, "bakeri", _seeded.Groceries);

        Assert.Equal(3, edited.TransactionsChanged);
        Assert.Equal([_seeded.Other, null, _seeded.Groceries], await CategoriesOf(ids));
    }

    [Fact]
    public async Task Put_OnlyTheKeywordsCase_IsAllowedAndChangesNoTransactions()
    {
        var ids = await Imported("Butikk Sentrum");
        var ruleId = await AddedRuleId("butikk", _seeded.Groceries);

        var edited = await EditedRule(ruleId, " BUTIKK ", _seeded.Groceries);

        Assert.Equal(
            new SavedCategorizationRuleResponse(ruleId, "BUTIKK", _seeded.Groceries, AiGenerated: false, IsNew: false, 0),
            edited);
        Assert.Equal([_seeded.Groceries], await CategoriesOf(ids));
    }

    [Fact]
    public async Task Put_KeywordOfAnotherRule_IsRejected()
    {
        await AddedRuleId("kafé", _seeded.Restaurants);
        var ruleId = await AddedRuleId("butikk", _seeded.Groceries);

        var response = await EditRule(ruleId, "KAFÉ", _seeded.Groceries);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        Assert.Equal(["A rule for 'kafé' already exists."], problem!.Errors["keyword"]);
    }

    [Fact]
    public async Task Put_InvalidRequest_IsRejectedWithErrorPerField()
    {
        var ruleId = await AddedRuleId("butikk", _seeded.Groceries);

        var response = await EditRule(ruleId, " x ", 9999);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        Assert.Equal(["Keyword must be at least 2 characters."], problem!.Errors["keyword"]);
        Assert.Equal(["Category does not exist."], problem.Errors["categoryId"]);
    }

    [Fact]
    public async Task Put_UnknownRule_ReturnsNotFound()
    {
        var response = await EditRule(int.MaxValue, "butikk", _seeded.Groceries);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // The rule endpoints never set the mark, so the tests set it directly in the database.
    private async Task MarkAiGenerated(int ruleId)
    {
        await using var user = await UserDatabase.OfAsync(_factory, _email);
        var db = user.Db;
        var rule = await db.CategorizationRules.SingleAsync(r => r.Id == ruleId);
        rule.AiGenerated = true;
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task Get_AiGeneratedRule_IsReportedAsAiGenerated()
    {
        var aiRuleId = await AddedRuleId("kafé", _seeded.Restaurants);
        var handAddedRuleId = await AddedRuleId("butikk", _seeded.Groceries);
        await MarkAiGenerated(aiRuleId);

        var rules = await _client.GetFromJsonAsync<List<CategorizationRuleResponse>>("/api/categorization-rules");

        Assert.Contains(new CategorizationRuleResponse(aiRuleId, "kafé", _seeded.Restaurants, AiGenerated: true, IsNew: false), rules!);
        Assert.Contains(new CategorizationRuleResponse(handAddedRuleId, "butikk", _seeded.Groceries, AiGenerated: false, IsNew: false), rules!);
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
            new { keyword = "butikk", categoryId = _seeded.Groceries, aiGenerated = true });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<SavedCategorizationRuleResponse>();
        Assert.False(created!.AiGenerated);
        var rules = await _client.GetFromJsonAsync<List<CategorizationRuleResponse>>("/api/categorization-rules");
        Assert.False(rules!.Single(r => r.Id == created.Id).AiGenerated);
    }

    [Fact]
    public async Task Put_AiGeneratedRule_LosesTheMarkWhenItsKeywordAndCategoryChange()
    {
        var ruleId = await AddedRuleId("kafé", _seeded.Restaurants);
        await MarkAiGenerated(ruleId);

        var edited = await EditedRule(ruleId, "bakeri", _seeded.Groceries);

        Assert.False(edited.AiGenerated);
        var rules = await _client.GetFromJsonAsync<List<CategorizationRuleResponse>>("/api/categorization-rules");
        Assert.Contains(new CategorizationRuleResponse(ruleId, "bakeri", _seeded.Groceries, AiGenerated: false, IsNew: false), rules!);
    }

    [Fact]
    public async Task Put_AiGeneratedRuleSavedUnchanged_LosesTheMark()
    {
        var ruleId = await AddedRuleId("kafé", _seeded.Restaurants);
        await MarkAiGenerated(ruleId);

        var edited = await EditedRule(ruleId, "kafé", _seeded.Restaurants);

        Assert.Equal(new SavedCategorizationRuleResponse(ruleId, "kafé", _seeded.Restaurants, AiGenerated: false, IsNew: false, 0), edited);
        var rules = await _client.GetFromJsonAsync<List<CategorizationRuleResponse>>("/api/categorization-rules");
        Assert.Contains(new CategorizationRuleResponse(ruleId, "kafé", _seeded.Restaurants, AiGenerated: false, IsNew: false), rules!);
    }

    [Fact]
    public async Task Put_RequestClaimingAiGenerated_LeavesAHandAddedRuleUnmarked()
    {
        var ruleId = await AddedRuleId("butikk", _seeded.Groceries);

        var response = await _client.PutAsJsonAsync(
            $"/api/categorization-rules/{ruleId}",
            new { keyword = "butikk", categoryId = _seeded.Restaurants, aiGenerated = true });

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
        var ids = await Imported("Butikk Sentrum", "Butikk Nord", "Annet");
        await AddedRuleId("sent", _seeded.Other);
        var ruleId = await AddedRuleId("butikk", _seeded.Groceries);

        var changed = await TransactionsChangedByDeleting(ruleId);

        Assert.Equal(2, changed);
        Assert.Equal([_seeded.Other, null, null], await CategoriesOf(ids));
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
            description = "Butikk",
            amount = -100m,
            categoryId = _seeded.Other,
        });
        var manual = await response.Content.ReadFromJsonAsync<TransactionResponse>();
        var ruleId = await AddedRuleId("butikk", _seeded.Groceries);

        var edited = await EditedRule(ruleId, "butikk", _seeded.Restaurants);
        var deleted = await TransactionsChangedByDeleting(ruleId);

        Assert.Equal(0, edited.TransactionsChanged);
        Assert.Equal(0, deleted);
        Assert.Equal([_seeded.Other], await CategoriesOf(manual!.Id));
    }
}
