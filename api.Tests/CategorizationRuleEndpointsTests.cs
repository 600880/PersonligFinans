using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PersonligFinans.Api.Categories;
using PersonligFinans.Api.CategorizationRules;
using PersonligFinans.Api.Data;
using PersonligFinans.Api.Transactions;
using PersonligFinans.Api.Users;

namespace PersonligFinans.Api.Tests;

[Collection(ApiCollection.Name)]
public class CategorizationRuleEndpointsTests : IAsyncLifetime
{
    private readonly PostgresApiFactory _factory;
    private readonly string _email = SignedInClient.UniqueEmail();
    private HttpClient _client = null!;
    private TestCategories _categories = null!;

    public CategorizationRuleEndpointsTests(PostgresApiFactory factory)
    {
        _factory = factory;
    }

    public async Task InitializeAsync()
    {
        _client = await _factory.CreateSignedInClientAsync(_email);
        _categories = await TestCategories.Of(_client);
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<HttpResponseMessage> AddRule(string keyword, int? categoryId) =>
        await _client.PostAsJsonAsync("/api/categorization-rules", new { keyword, categoryId });

    [Fact]
    public async Task Post_ValidRule_IsCreatedAndListed()
    {
        var response = await AddRule("butikk", _categories.Groceries);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<SavedCategorizationRuleResponse>();
        Assert.Equal("butikk", created!.Keyword);
        Assert.Equal(_categories.Groceries, created.CategoryId);
        Assert.Equal(0, created.TransactionsChanged);

        var rules = await _client.GetFromJsonAsync<List<CategorizationRuleResponse>>("/api/categorization-rules");
        Assert.Contains(new CategorizationRuleResponse(created.Id, "butikk", _categories.Groceries, AiGenerated: false, IsNew: false), rules!);
    }

    [Fact]
    public async Task Get_ListsRulesSortedByKeyword()
    {
        await AddRule("butikk b", _categories.Groceries);
        await AddRule("butikk a", _categories.Groceries);

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
        Assert.Equal(_categories.Groceries, categoryByKeyword["rema"]);
        Assert.Equal(_categories.Transfers, categoryByKeyword["overføring mellom egne kontoer"]);
        Assert.Equal(_categories.Transport, categoryByKeyword["ruter"]);
    }

    [Fact]
    public async Task Get_FreshDatabase_ListsTheSeededClothingAndTransportRules()
    {
        var rules = await _client.GetFromJsonAsync<List<CategorizationRuleResponse>>("/api/categorization-rules");

        var categoryByKeyword = rules!.ToDictionary(r => r.Keyword, r => r.CategoryId);
        Assert.All(
            ["cubus", "dressmann", "h&m"],
            keyword => Assert.Equal(_categories.Clothing, categoryByKeyword[keyword]));
        Assert.All(
            ["vy", "skyss", "ruter"],
            keyword => Assert.Equal(_categories.Transport, categoryByKeyword[keyword]));
        Assert.False(rules!.Single(r => r.Keyword == "cubus").AiGenerated);
    }

    // Stores Transactions as if imported from a Bank Statement, all Uncategorized.
    private async Task<int[]> Imported(params string[] descriptions)
    {
        await using var user = await UserDatabase.OfAsync(_factory, _email);
        var db = user.Db;
        var statement = new BankStatement
        {
            UserId = db.OwnerOfNewRows,
            AccountNumber = Guid.NewGuid().ToString("N")[..AppDbContext.AccountNumberMaxLength],
            PeriodStart = new DateOnly(2026, 8, 1),
            PeriodEnd = new DateOnly(2026, 8, 31),
            ImportedAt = DateTimeOffset.UtcNow,
        };
        var transactions = descriptions
            .Select(d => new Transaction { UserId = db.OwnerOfNewRows, PostedDate = new DateOnly(2026, 8, 3), Description = d, Amount = -100m })
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

        var changed = await TransactionsChangedByAdding("butikk", _categories.Groceries);

        Assert.Equal(2, changed);
        Assert.Equal([_categories.Groceries, _categories.Groceries, null], await CategoriesOf(ids));
    }

    [Fact]
    public async Task Post_LongerRule_TakesOverTransactionsFromShorterRule()
    {
        var ids = await Imported("Butikk Kafé", "Butikk");
        await TransactionsChangedByAdding("butikk", _categories.Groceries);

        var changed = await TransactionsChangedByAdding("butikk kafé", _categories.Restaurants);

        Assert.Equal(1, changed);
        Assert.Equal([_categories.Restaurants, _categories.Groceries], await CategoriesOf(ids));
    }

    [Fact]
    public async Task Post_EquallyLongKeywords_OldestRuleWins()
    {
        var ids = await Imported("aaaa bbbb");
        await TransactionsChangedByAdding("bbbb", _categories.Groceries);

        var changed = await TransactionsChangedByAdding("aaaa", _categories.Restaurants);

        Assert.Equal(0, changed);
        Assert.Equal([_categories.Groceries], await CategoriesOf(ids));
    }

    [Fact]
    public async Task Post_Rule_MatchesIgnoringCaseIncludingNorwegianLetters()
    {
        var ids = await Imported("ØLSTUE BRYGGEN");

        await TransactionsChangedByAdding("ølstue", _categories.Restaurants);

        Assert.Equal([_categories.Restaurants], await CategoriesOf(ids));
    }

    [Fact]
    public async Task Post_Rule_NeverChangesManuallyEnteredTransactions()
    {
        var response = await _client.PostAsJsonAsync("/api/transactions", new
        {
            date = "2026-08-03",
            description = "Butikk",
            amount = -100m,
            categoryId = _categories.Other,
        });
        var manual = await response.Content.ReadFromJsonAsync<TransactionResponse>();

        var changed = await TransactionsChangedByAdding("butikk", _categories.Groceries);

        Assert.Equal(0, changed);
        Assert.Equal([_categories.Other], await CategoriesOf(manual!.Id));
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
        var errors = await AddRuleExpectingValidationErrors(null, _categories.Groceries);

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
        var errors = await AddRuleExpectingValidationErrors(" x ", _categories.Groceries);

        Assert.Equal(["Keyword must be at least 2 characters."], errors["keyword"]);
    }

    [Fact]
    public async Task Post_KeywordLongerThanOneHundredCharacters_IsRejected()
    {
        var errors = await AddRuleExpectingValidationErrors(new string('x', 101), _categories.Groceries);

        Assert.Equal(["Keyword must be at most 100 characters."], errors["keyword"]);
    }

    [Fact]
    public async Task Post_KeywordThatExistsIgnoringCase_IsRejected()
    {
        Assert.Equal(HttpStatusCode.Created, (await AddRule("kafé", _categories.Groceries)).StatusCode);

        var errors = await AddRuleExpectingValidationErrors("  KAFÉ ", _categories.Groceries);

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
        var ruleId = await AddedRuleId("butikk", _categories.Groceries);

        var edited = await EditedRule(ruleId, "butikk", _categories.Restaurants);

        Assert.Equal(new SavedCategorizationRuleResponse(ruleId, "butikk", _categories.Restaurants, AiGenerated: false, IsNew: false, 2), edited);
        Assert.Equal([_categories.Restaurants, _categories.Restaurants, null], await CategoriesOf(ids));
        var rules = await _client.GetFromJsonAsync<List<CategorizationRuleResponse>>("/api/categorization-rules");
        Assert.Contains(new CategorizationRuleResponse(ruleId, "butikk", _categories.Restaurants, AiGenerated: false, IsNew: false), rules!);
    }

    [Fact]
    public async Task Put_KeywordChange_ReleasesTransactionsAndPicksUpNewOnes()
    {
        var ids = await Imported("Butikk Sentrum", "Butikk Nord", "Bakeri");
        await AddedRuleId("sent", _categories.Other);
        var ruleId = await AddedRuleId("butikk", _categories.Groceries);

        var edited = await EditedRule(ruleId, "bakeri", _categories.Groceries);

        Assert.Equal(3, edited.TransactionsChanged);
        Assert.Equal([_categories.Other, null, _categories.Groceries], await CategoriesOf(ids));
    }

    [Fact]
    public async Task Put_OnlyTheKeywordsCase_IsAllowedAndChangesNoTransactions()
    {
        var ids = await Imported("Butikk Sentrum");
        var ruleId = await AddedRuleId("butikk", _categories.Groceries);

        var edited = await EditedRule(ruleId, " BUTIKK ", _categories.Groceries);

        Assert.Equal(
            new SavedCategorizationRuleResponse(ruleId, "BUTIKK", _categories.Groceries, AiGenerated: false, IsNew: false, 0),
            edited);
        Assert.Equal([_categories.Groceries], await CategoriesOf(ids));
    }

    [Fact]
    public async Task Put_KeywordOfAnotherRule_IsRejected()
    {
        await AddedRuleId("kafé", _categories.Restaurants);
        var ruleId = await AddedRuleId("butikk", _categories.Groceries);

        var response = await EditRule(ruleId, "KAFÉ", _categories.Groceries);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        Assert.Equal(["A rule for 'kafé' already exists."], problem!.Errors["keyword"]);
    }

    [Fact]
    public async Task Put_InvalidRequest_IsRejectedWithErrorPerField()
    {
        var ruleId = await AddedRuleId("butikk", _categories.Groceries);

        var response = await EditRule(ruleId, " x ", 9999);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        Assert.Equal(["Keyword must be at least 2 characters."], problem!.Errors["keyword"]);
        Assert.Equal(["Category does not exist."], problem.Errors["categoryId"]);
    }

    [Fact]
    public async Task Put_UnknownRule_ReturnsNotFound()
    {
        var response = await EditRule(int.MaxValue, "butikk", _categories.Groceries);

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
        var aiRuleId = await AddedRuleId("kafé", _categories.Restaurants);
        var handAddedRuleId = await AddedRuleId("butikk", _categories.Groceries);
        await MarkAiGenerated(aiRuleId);

        var rules = await _client.GetFromJsonAsync<List<CategorizationRuleResponse>>("/api/categorization-rules");

        Assert.Contains(new CategorizationRuleResponse(aiRuleId, "kafé", _categories.Restaurants, AiGenerated: true, IsNew: false), rules!);
        Assert.Contains(new CategorizationRuleResponse(handAddedRuleId, "butikk", _categories.Groceries, AiGenerated: false, IsNew: false), rules!);
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
            new { keyword = "butikk", categoryId = _categories.Groceries, aiGenerated = true });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<SavedCategorizationRuleResponse>();
        Assert.False(created!.AiGenerated);
        var rules = await _client.GetFromJsonAsync<List<CategorizationRuleResponse>>("/api/categorization-rules");
        Assert.False(rules!.Single(r => r.Id == created.Id).AiGenerated);
    }

    [Fact]
    public async Task Put_AiGeneratedRule_LosesTheMarkWhenItsKeywordAndCategoryChange()
    {
        var ruleId = await AddedRuleId("kafé", _categories.Restaurants);
        await MarkAiGenerated(ruleId);

        var edited = await EditedRule(ruleId, "bakeri", _categories.Groceries);

        Assert.False(edited.AiGenerated);
        var rules = await _client.GetFromJsonAsync<List<CategorizationRuleResponse>>("/api/categorization-rules");
        Assert.Contains(new CategorizationRuleResponse(ruleId, "bakeri", _categories.Groceries, AiGenerated: false, IsNew: false), rules!);
    }

    [Fact]
    public async Task Put_AiGeneratedRuleSavedUnchanged_LosesTheMark()
    {
        var ruleId = await AddedRuleId("kafé", _categories.Restaurants);
        await MarkAiGenerated(ruleId);

        var edited = await EditedRule(ruleId, "kafé", _categories.Restaurants);

        Assert.Equal(new SavedCategorizationRuleResponse(ruleId, "kafé", _categories.Restaurants, AiGenerated: false, IsNew: false, 0), edited);
        var rules = await _client.GetFromJsonAsync<List<CategorizationRuleResponse>>("/api/categorization-rules");
        Assert.Contains(new CategorizationRuleResponse(ruleId, "kafé", _categories.Restaurants, AiGenerated: false, IsNew: false), rules!);
    }

    [Fact]
    public async Task Put_RequestClaimingAiGenerated_LeavesAHandAddedRuleUnmarked()
    {
        var ruleId = await AddedRuleId("butikk", _categories.Groceries);

        var response = await _client.PutAsJsonAsync(
            $"/api/categorization-rules/{ruleId}",
            new { keyword = "butikk", categoryId = _categories.Restaurants, aiGenerated = true });

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
        await AddedRuleId("sent", _categories.Other);
        var ruleId = await AddedRuleId("butikk", _categories.Groceries);

        var changed = await TransactionsChangedByDeleting(ruleId);

        Assert.Equal(2, changed);
        Assert.Equal([_categories.Other, null, null], await CategoriesOf(ids));
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
            categoryId = _categories.Other,
        });
        var manual = await response.Content.ReadFromJsonAsync<TransactionResponse>();
        var ruleId = await AddedRuleId("butikk", _categories.Groceries);

        var edited = await EditedRule(ruleId, "butikk", _categories.Restaurants);
        var deleted = await TransactionsChangedByDeleting(ruleId);

        Assert.Equal(0, edited.TransactionsChanged);
        Assert.Equal(0, deleted);
        Assert.Equal([_categories.Other], await CategoriesOf(manual!.Id));
    }

    private Task<HttpResponseMessage> DeleteAllRules() => _client.DeleteAsync("/api/categorization-rules");

    private async Task<List<CategorizationRuleResponse>> ListedRules() =>
        (await _client.GetFromJsonAsync<List<CategorizationRuleResponse>>("/api/categorization-rules"))!;

    // Uploads an August 2026 Bank Statement with a purchase from each merchant, which must import.
    private async Task UploadPurchasesFrom(params string[] merchants)
    {
        var file = new ByteArrayContent(StatementPdf.WithPurchasesFrom(merchants));
        file.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
        using var form = new MultipartFormDataContent { { file, "file", "kontoutskrift.pdf" } };
        Assert.Equal(HttpStatusCode.Created, (await _client.PostAsync("/api/bank-statements", form)).StatusCode);
    }

    // Each of the User's August 2026 Transactions, by description, with its Category.
    private async Task<Dictionary<string, int?>> AugustCategories() =>
        (await _client.GetFromJsonAsync<List<TransactionResponse>>("/api/transactions?year=2026&month=8"))!
            .ToDictionary(t => t.Description, t => t.CategoryId);

    // Categorizes the August 2026 Transaction with the description by hand, which Locks it.
    private async Task CategorizeByHand(string description, int categoryId)
    {
        var august = await _client.GetFromJsonAsync<List<TransactionResponse>>("/api/transactions?year=2026&month=8");
        var transaction = august!.Single(t => t.Description == description);
        var response = await _client.PutAsJsonAsync($"/api/transactions/{transaction.Id}/category", new { categoryId });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    private async Task AddManualAugustTransaction(string description, int categoryId)
    {
        var response = await _client.PostAsJsonAsync("/api/transactions", new
        {
            date = "2026-08-05", description, amount = -100m, categoryId,
        });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    [Fact]
    public async Task DeleteAll_DeletesEveryRuleSeededOnesIncluded_AndUncategorizesWhatTheyCategorized()
    {
        await AddedRuleId("kafé", _categories.Restaurants);
        await UploadPurchasesFrom("Kafé", "Rema 1000", "Kiosk");
        Assert.Equal(
            new Dictionary<string, int?> { ["Kafé"] = _categories.Restaurants, ["Rema 1000"] = _categories.Groceries, ["Kiosk"] = null },
            await AugustCategories());
        var ruleCount = (await ListedRules()).Count;

        var response = await DeleteAllRules();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(
            new DeletedCategorizationRulesResponse(RulesDeleted: ruleCount),
            await response.Content.ReadFromJsonAsync<DeletedCategorizationRulesResponse>());
        Assert.Empty(await ListedRules());
        Assert.Equal(
            new Dictionary<string, int?> { ["Kafé"] = null, ["Rema 1000"] = null, ["Kiosk"] = null },
            await AugustCategories());
    }

    [Fact]
    public async Task DeleteAll_LeavesLockedTransactionsAndTheCategoriesAsTheyWere()
    {
        await UploadPurchasesFrom("Rema 1000", "Kiwi Sentrum");
        // Locked, though a seeded rule matches it.
        await CategorizeByHand("Kiwi Sentrum", _categories.Other);
        await AddManualAugustTransaction("Rema 1000 Torget", _categories.Restaurants);
        var categories = await _client.GetFromJsonAsync<List<CategoryResponse>>("/api/categories");

        Assert.Equal(HttpStatusCode.OK, (await DeleteAllRules()).StatusCode);

        Assert.Equal(
            new Dictionary<string, int?>
            {
                ["Rema 1000"] = null,
                ["Kiwi Sentrum"] = _categories.Other,
                ["Rema 1000 Torget"] = _categories.Restaurants,
            },
            await AugustCategories());
        // Each Category's counts of Transactions and rules change with the delete, not the Category.
        Assert.Equal(
            categories!.Select(c => (c.Id, c.Name, c.Description, c.Colour, c.BuiltIn)),
            (await _client.GetFromJsonAsync<List<CategoryResponse>>("/api/categories"))!.Select(c => (c.Id, c.Name, c.Description, c.Colour, c.BuiltIn)));
    }

    private async Task<DeleteCountsResponse> DeleteCounts() =>
        (await _client.GetFromJsonAsync<DeleteCountsResponse>("/api/user/delete-counts"))!;

    [Fact]
    public async Task GetDeleteCounts_CountsTheRules_AndTheTransactionsThatDeletingAllRulesThenUncategorizes()
    {
        // Two categorized by a seeded rule, one no rule matches, and one Locked though a rule matches it.
        await UploadPurchasesFrom("Rema 1000", "Cubus", "Kiosk", "Kiwi Sentrum");
        await CategorizeByHand("Kiwi Sentrum", _categories.Other);
        await AddManualAugustTransaction("Rema 1000 Torget", _categories.Groceries);
        var before = await AugustCategories();

        var counted = await DeleteCounts();
        var response = await DeleteAllRules();

        Assert.Equal((await response.Content.ReadFromJsonAsync<DeletedCategorizationRulesResponse>())!.RulesDeleted, counted.RuleCount);
        Assert.Equal(2, counted.RuleCategorizedTransactionCount);
        var after = await AugustCategories();
        Assert.Equal(
            ["Cubus", "Rema 1000"],
            before.Keys.Where(d => before[d] != after[d]).Order());
        Assert.Equal(new DeleteCountsResponse(TransactionCount: 5, RuleCount: 0, RuleCategorizedTransactionCount: 0), await DeleteCounts());
    }

    [Fact]
    public async Task DeleteAll_WithNoRules_DeletesNone()
    {
        Assert.Equal(HttpStatusCode.OK, (await DeleteAllRules()).StatusCode);

        var response = await DeleteAllRules();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(new DeletedCategorizationRulesResponse(RulesDeleted: 0), await response.Content.ReadFromJsonAsync<DeletedCategorizationRulesResponse>());
    }
}
