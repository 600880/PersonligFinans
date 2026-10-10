using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PersonligFinans.Api.CategorizationRules;
using PersonligFinans.Api.Categories;
using PersonligFinans.Api.Data;
using PersonligFinans.Api.Spending;
using PersonligFinans.Api.Transactions;

namespace PersonligFinans.Api.Tests;

[Collection(ApiCollection.Name)]
public class CategoryEndpointsTests : IAsyncLifetime
{
    private const int GroceriesId = 1;
    private const int TravelId = 10;
    private const int OtherId = 13;
    private const int ElectronicsId = 15;

    private readonly PostgresApiFactory _factory;
    private readonly HttpClient _client;

    // The tests share one database, so each test's keywords, descriptions and Category names
    // contain a token of its own.
    private readonly string _token = "t" + Guid.NewGuid().ToString("N")[..8];

    public CategoryEndpointsTests(PostgresApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    public Task InitializeAsync() => Task.CompletedTask;

    // Removes the Categories the test created, and the rules and Transactions using them, since
    // other tests expect only the seeded Categories, e.g. among those offered to the rule generator.
    // Also removes the test's own Transactions, which a delete may have left Uncategorized or in Other.
    public async Task DisposeAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var created = db.Categories.Where(c => c.Name.ToLower().Contains(_token));
        await db.Transactions
            .Where(t => created.Any(c => c.Id == t.CategoryId) || t.Description.ToLower().Contains(_token))
            .ExecuteDeleteAsync();
        await db.CategorizationRules.Where(r => created.Any(c => c.Id == r.CategoryId)).ExecuteDeleteAsync();
        await created.ExecuteDeleteAsync();
    }

    // Adds a Category straight to the database, and returns its id. Its name must contain the
    // test's token, so that it is removed afterwards.
    private async Task<int> CreateCategory(string name, string description = "Made by a test.", bool builtIn = false)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var category = new Category
        {
            Name = name,
            Description = description,
            Colour = CategoryColours.Fallback,
            BuiltIn = builtIn,
        };
        db.Categories.Add(category);
        await db.SaveChangesAsync();
        return category.Id;
    }

    private async Task<List<CategoryResponse>> ListCategories() =>
        (await _client.GetFromJsonAsync<List<CategoryResponse>>("/api/categories"))!;

    // Other tests add Categories of their own, which these leave out.
    private async Task<List<CategoryResponse>> ListSeededCategories() =>
        (await ListCategories()).Where(c => SeedCategories.All.Any(s => s.Id == c.Id)).ToList();

    [Fact]
    public async Task Get_FreshDatabase_ListsTheSeededCategoriesWithDescriptionsAndBuiltInFlags()
    {
        var categories = await ListSeededCategories();

        var byName = categories.ToDictionary(c => c.Name);
        Assert.Equal(
            new Dictionary<string, (string, bool)>
            {
                ["Housing"] = ("Mortgage, common costs and insurance.", true),
                ["Groceries"] = ("All groceries.", true),
                ["Electronics"] = ("All electronics.", false),
                ["Entertainment"] = ("Movies, video games etc.", false),
                ["Clothing"] = ("All clothing.", true),
                ["Income"] = ("All income.", true),
                ["Utilities"] = ("Electricity, water, phone, internet etc.", false),
                ["Health"] = ("Pharmacy etc.", false),
                ["Transfers"] = ("All private transfers.", true),
                ["Transport"] = ("All transport.", true),
                ["Travel"] = ("All travel.", false),
                ["Restaurants"] = ("Restaurant, takeaway, bakery etc.", false),
                ["Shopping"] = ("All shopping.", false),
                ["Subscriptions"] = ("All subscriptions.", false),
                ["Other"] = ("Costs that don't belong in any other category.", true),
            },
            byName.ToDictionary(c => c.Key, c => (c.Value.Description, c.Value.BuiltIn)));
    }

    [Fact]
    public async Task Get_FreshDatabase_GivesTheSeededCategoriesTheirColours()
    {
        var colours = (await ListSeededCategories()).ToDictionary(c => c.Id, c => c.Colour);

        Assert.Equal(
            new Dictionary<int, string>
            {
                [1] = "#2a78d6",
                [2] = "#eb6834",
                [3] = "#1baf7a",
                [4] = "#eda100",
                [5] = "#e87ba4",
                [6] = "#008300",
                [7] = "#4a3aa7",
                [8] = "#e34948",
                [9] = "#104281",
                [10] = "#86b6ef",
                [11] = "#8a5a1c",
                [12] = "#0f766e",
                [13] = "#9085e9",
                [14] = "#b8336a",
                [15] = "#6b8e23",
            },
            colours);
    }

    [Fact]
    public async Task Get_ListsCategoriesOrderedByName()
    {
        var names = (await ListCategories()).Select(c => c.Name).ToList();

        Assert.Equal(names.Order(StringComparer.Ordinal), names);
    }

    [Fact]
    public async Task Get_CountsTheTransactionsAndRulesUsingEachCategory()
    {
        var before = (await ListCategories()).ToDictionary(c => c.Id);

        foreach (var description in new[] { $"{_token} Mobil", $"{_token} Lader" })
        {
            var transaction = await _client.PostAsJsonAsync("/api/transactions", new
            {
                date = "2026-08-03",
                description,
                amount = -100m,
                categoryId = ElectronicsId,
            });
            Assert.Equal(HttpStatusCode.Created, transaction.StatusCode);
        }
        var rule = await _client.PostAsJsonAsync(
            "/api/categorization-rules", new { keyword = $"{_token} elektro", categoryId = ElectronicsId });
        Assert.Equal(HttpStatusCode.Created, rule.StatusCode);

        var after = (await ListCategories()).ToDictionary(c => c.Id);
        Assert.Equal(before[ElectronicsId].TransactionCount + 2, after[ElectronicsId].TransactionCount);
        Assert.Equal(before[ElectronicsId].RuleCount + 1, after[ElectronicsId].RuleCount);
        Assert.Equal(before[TravelId].TransactionCount, after[TravelId].TransactionCount);
        Assert.Equal(before[TravelId].RuleCount, after[TravelId].RuleCount);
    }

    [Fact]
    public async Task CategoryNames_AreUniqueIgnoringCase()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        // Rolled back when disposed, so the Categories never reach the other tests.
        await using var transaction = await db.Database.BeginTransactionAsync();
        db.Categories.Add(new Category { Name = $"{_token} Hobby", Description = "Hobbies.", Colour = CategoryColours.Fallback });
        await db.SaveChangesAsync();

        db.Categories.Add(new Category { Name = $"{_token.ToUpperInvariant()} HOBBY", Description = "Hobbies.", Colour = CategoryColours.Fallback });

        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task Delete_UnusedCategory_DeletesItAndChangesNoTransactions()
    {
        var id = await CreateCategory($"{_token} Hobby");

        var response = await _client.DeleteAsync($"/api/categories/{id}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var deleted = await response.Content.ReadFromJsonAsync<DeletedCategoryResponse>();
        Assert.Equal(0, deleted!.TransactionsChanged);
        Assert.DoesNotContain(await ListCategories(), c => c.Id == id);
    }

    [Fact]
    public async Task Delete_UnknownCategory_ReturnsNotFound()
    {
        var response = await _client.DeleteAsync($"/api/categories/{int.MaxValue}");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Delete_BuiltInCategory_IsAValidationProblem()
    {
        var id = await CreateCategory($"{_token} Pets", builtIn: true);

        var response = await _client.DeleteAsync($"/api/categories/{id}");

        await AssertCategoryProblem(response, $"{_token} Pets is a Built-in Category, so it can't be deleted.");
        Assert.Contains(await ListCategories(), c => c.Id == id);
    }

    [Fact]
    public async Task Delete_CategoryATransactionUses_IsAValidationProblem()
    {
        var id = await CreateCategory($"{_token} Garden");
        var transaction = await _client.PostAsJsonAsync("/api/transactions", new
        {
            date = "2026-08-03",
            description = $"{_token} Plantasjen",
            amount = -100m,
            categoryId = id,
        });
        Assert.Equal(HttpStatusCode.Created, transaction.StatusCode);

        var response = await _client.DeleteAsync($"/api/categories/{id}");

        await AssertCategoryProblem(response, $"{_token} Garden is in use, so it can't be deleted.");
        Assert.Contains(await ListCategories(), c => c.Id == id);
    }

    [Fact]
    public async Task Delete_CategoryARuleUses_IsAValidationProblem()
    {
        var id = await CreateCategory($"{_token} Garden");
        var rule = await _client.PostAsJsonAsync(
            "/api/categorization-rules", new { keyword = $"{_token} plantasjen", categoryId = id });
        Assert.Equal(HttpStatusCode.Created, rule.StatusCode);

        var response = await _client.DeleteAsync($"/api/categories/{id}");

        await AssertCategoryProblem(response, $"{_token} Garden is in use, so it can't be deleted.");
        Assert.Contains(await ListCategories(), c => c.Id == id);
    }

    private static async Task AssertCategoryProblem(HttpResponseMessage response, string message, string key = "category")
    {
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        Assert.Equal([message], problem!.Errors[key]);
    }

    private Task<HttpResponseMessage> DeleteWithReplacement(int id, int replacementId) =>
        _client.DeleteAsync($"/api/categories/{id}?replacementCategoryId={replacementId}");

    private async Task<int> TransactionsChangedByDeleting(int id, int replacementId)
    {
        var response = await DeleteWithReplacement(id, replacementId);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<DeletedCategoryResponse>())!.TransactionsChanged;
    }

    // Stores Transactions as if imported from a Bank Statement, all Uncategorized.
    private Task<int[]> Imported(params string[] descriptions) => ImportedOn(new DateOnly(2026, 8, 3), descriptions);

    private async Task<int[]> ImportedOn(DateOnly postedDate, params string[] descriptions)
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
            .Select(d => new Transaction { PostedDate = postedDate, Description = d, Amount = -100m })
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

    private async Task<int> AddedRuleId(string keyword, int categoryId)
    {
        var response = await _client.PostAsJsonAsync("/api/categorization-rules", new { keyword, categoryId });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<SavedCategorizationRuleResponse>())!.Id;
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

    private async Task<CategorizationRuleResponse> Rule(int ruleId) =>
        (await _client.GetFromJsonAsync<List<CategorizationRuleResponse>>("/api/categorization-rules"))!
            .Single(r => r.Id == ruleId);

    private async Task<int> ManuallyEntered(string description, int categoryId, string date = "2026-08-03")
    {
        var response = await _client.PostAsJsonAsync("/api/transactions", new
        {
            date,
            description,
            amount = -100m,
            categoryId,
        });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<TransactionResponse>())!.Id;
    }

    [Fact]
    public async Task Delete_WithReplacement_RuleCategorizedTransactionsFollowTheirRule()
    {
        var id = await CreateCategory($"{_token} Garden");
        var replacementId = await CreateCategory($"{_token} Home");
        var laterId = await CreateCategory($"{_token} Hobby");
        var transactionIds = await Imported($"{_token} Plantasjen Oslo", $"{_token} Plantasjen Bergen");
        var ruleId = await AddedRuleId($"{_token} plantasjen", id);

        var changed = await TransactionsChangedByDeleting(id, replacementId);

        Assert.Equal(2, changed);
        Assert.DoesNotContain(await ListCategories(), c => c.Id == id);
        Assert.Equal(replacementId, (await Rule(ruleId)).CategoryId);
        Assert.Equal([replacementId, replacementId], await CategoriesOf(transactionIds));

        // Still categorized by the rule, so they follow it when it changes.
        var edited = await _client.PutAsJsonAsync(
            $"/api/categorization-rules/{ruleId}", new { keyword = $"{_token} plantasjen", categoryId = laterId });
        Assert.Equal(HttpStatusCode.OK, edited.StatusCode);
        Assert.Equal([laterId, laterId], await CategoriesOf(transactionIds));
    }

    [Fact]
    public async Task Delete_WithReplacement_ManuallyCategorizedTransactionsStayManual()
    {
        var id = await CreateCategory($"{_token} Garden");
        var replacementId = await CreateCategory($"{_token} Home");
        var laterId = await CreateCategory($"{_token} Hobby");
        var transactionId = (await Imported($"{_token} Plantasjen"))[0];
        var categorized = await _client.PutAsJsonAsync(
            $"/api/transactions/{transactionId}/category", new { categoryId = id });
        Assert.Equal(HttpStatusCode.OK, categorized.StatusCode);

        var changed = await TransactionsChangedByDeleting(id, replacementId);

        Assert.Equal(1, changed);
        Assert.Equal([replacementId], await CategoriesOf(transactionId));

        // A later rule change leaves it alone.
        await AddedRuleId($"{_token} plantasjen", laterId);
        Assert.Equal([replacementId], await CategoriesOf(transactionId));
    }

    [Fact]
    public async Task Delete_WithReplacement_MovesManuallyEnteredTransactions()
    {
        var id = await CreateCategory($"{_token} Garden");
        var replacementId = await CreateCategory($"{_token} Home");
        var transactionId = await ManuallyEntered($"{_token} Plantasjen", id);

        var changed = await TransactionsChangedByDeleting(id, replacementId);

        Assert.Equal(1, changed);
        Assert.Equal([replacementId], await CategoriesOf(transactionId));
    }

    [Fact]
    public async Task Delete_WithReplacement_CountsEveryMovedTransaction()
    {
        var id = await CreateCategory($"{_token} Garden");
        var replacementId = await CreateCategory($"{_token} Home");
        var ruleCategorized = await Imported($"{_token} Plantasjen Oslo");
        await AddedRuleId($"{_token} plantasjen", id);
        var manual = (await Imported($"{_token} Hageland"))[0];
        await _client.PutAsJsonAsync($"/api/transactions/{manual}/category", new { categoryId = id });
        await ManuallyEntered($"{_token} Felleskjøpet", id);
        var untouched = await ManuallyEntered($"{_token} Mester Grønn", replacementId);

        var changed = await TransactionsChangedByDeleting(id, replacementId);

        Assert.Equal(3, changed);
        Assert.Equal([replacementId, replacementId], await CategoriesOf(ruleCategorized[0], untouched));
    }

    [Fact]
    public async Task Delete_WithReplacementOtherThanOther_KeepsTheAiMarkOnMovedRules()
    {
        var id = await CreateCategory($"{_token} Garden");
        var replacementId = await CreateCategory($"{_token} Home");
        var ruleId = await AddedRuleId($"{_token} plantasjen", id);
        await MarkAiGenerated(ruleId);

        await TransactionsChangedByDeleting(id, replacementId);

        Assert.Equal(new CategorizationRuleResponse(ruleId, $"{_token} plantasjen", replacementId, AiGenerated: true), await Rule(ruleId));
    }

    [Fact]
    public async Task Delete_WithOtherAsReplacement_ClearsTheAiMarkOnMovedRules()
    {
        var id = await CreateCategory($"{_token} Garden");
        var aiRuleId = await AddedRuleId($"{_token} plantasjen", id);
        await MarkAiGenerated(aiRuleId);
        var ordinaryRuleId = await AddedRuleId($"{_token} hageland", id);
        try
        {
            await TransactionsChangedByDeleting(id, OtherId);

            Assert.Equal(new CategorizationRuleResponse(aiRuleId, $"{_token} plantasjen", OtherId, AiGenerated: false), await Rule(aiRuleId));
            Assert.Equal(new CategorizationRuleResponse(ordinaryRuleId, $"{_token} hageland", OtherId, AiGenerated: false), await Rule(ordinaryRuleId));
        }
        finally
        {
            // The rules now have Other, which the cleanup leaves alone.
            await _client.DeleteAsync($"/api/categorization-rules/{aiRuleId}");
            await _client.DeleteAsync($"/api/categorization-rules/{ordinaryRuleId}");
        }
    }

    [Fact]
    public async Task Delete_WithReplacementOfAnUnusedCategory_DeletesItAndChangesNoTransactions()
    {
        var id = await CreateCategory($"{_token} Garden");
        var replacementId = await CreateCategory($"{_token} Home");

        Assert.Equal(0, await TransactionsChangedByDeleting(id, replacementId));
        Assert.DoesNotContain(await ListCategories(), c => c.Id == id);
    }

    [Fact]
    public async Task Delete_ReplacementIsTheCategoryItself_IsAValidationProblem()
    {
        var id = await CreateCategory($"{_token} Garden");
        var transactionId = await ManuallyEntered($"{_token} Plantasjen", id);

        var response = await DeleteWithReplacement(id, id);

        await AssertCategoryProblem(
            response, "The replacement must be another Category.", key: "replacementCategoryId");
        Assert.Contains(await ListCategories(), c => c.Id == id);
        Assert.Equal([id], await CategoriesOf(transactionId));
    }

    [Fact]
    public async Task Delete_ReplacementDoesNotExist_IsAValidationProblem()
    {
        var id = await CreateCategory($"{_token} Garden");
        var transactionId = await ManuallyEntered($"{_token} Plantasjen", id);

        var response = await DeleteWithReplacement(id, int.MaxValue);

        await AssertCategoryProblem(
            response, "The replacement Category does not exist.", key: "replacementCategoryId");
        Assert.Contains(await ListCategories(), c => c.Id == id);
        Assert.Equal([id], await CategoriesOf(transactionId));
    }

    [Fact]
    public async Task Delete_BuiltInCategoryWithReplacement_IsAValidationProblem()
    {
        var id = await CreateCategory($"{_token} Pets", builtIn: true);
        var replacementId = await CreateCategory($"{_token} Home");

        var response = await DeleteWithReplacement(id, replacementId);

        await AssertCategoryProblem(response, $"{_token} Pets is a Built-in Category, so it can't be deleted.");
        Assert.Contains(await ListCategories(), c => c.Id == id);
    }

    private Task<HttpResponseMessage> DeleteWithItsRules(int id) =>
        _client.DeleteAsync($"/api/categories/{id}?deleteRules=true");

    private async Task<int> TransactionsChangedByDeletingWithItsRules(int id)
    {
        var response = await DeleteWithItsRules(id);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<DeletedCategoryResponse>())!.TransactionsChanged;
    }

    private async Task CategorizeManually(int transactionId, int categoryId)
    {
        var response = await _client.PutAsJsonAsync(
            $"/api/transactions/{transactionId}/category", new { categoryId });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    // Only an import sets the mark, so the tests set it directly in the database.
    private async Task PlaceInOther(int transactionId)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var transaction = await db.Transactions.SingleAsync(t => t.Id == transactionId);
        transaction.CategoryId = OtherId;
        transaction.AiPlacedInOther = true;
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task Delete_WithItsRules_DeletesTheRulesAndTheCategory()
    {
        var id = await CreateCategory($"{_token} Garden");
        var ruleId = await AddedRuleId($"{_token} plantasjen", id);

        await TransactionsChangedByDeletingWithItsRules(id);

        Assert.DoesNotContain(await ListCategories(), c => c.Id == id);
        Assert.DoesNotContain(
            (await _client.GetFromJsonAsync<List<CategorizationRuleResponse>>("/api/categorization-rules"))!,
            r => r.Id == ruleId);
    }

    [Fact]
    public async Task Delete_WithItsRules_AShorterRemainingRuleForAnotherCategoryPicksUpItsTransactions()
    {
        var id = await CreateCategory($"{_token} Garden");
        var otherCategoryId = await CreateCategory($"{_token} Home");
        var transactionIds = await Imported($"{_token} Plantasjen Oslo", $"{_token} Plant Shop");
        await AddedRuleId($"{_token} plant", otherCategoryId);
        await AddedRuleId($"{_token} plantasjen", id);
        Assert.Equal([id, otherCategoryId], await CategoriesOf(transactionIds));

        var changed = await TransactionsChangedByDeletingWithItsRules(id);

        Assert.Equal(1, changed);
        Assert.Equal([otherCategoryId, otherCategoryId], await CategoriesOf(transactionIds));
    }

    [Fact]
    public async Task Delete_WithItsRules_ImportedTransactionsNoRemainingRuleMatchesBecomeUncategorized()
    {
        var id = await CreateCategory($"{_token} Garden");
        var transactionIds = await Imported($"{_token} Plantasjen Oslo", $"{_token} Plantasjen Bergen");
        await AddedRuleId($"{_token} plantasjen", id);

        var changed = await TransactionsChangedByDeletingWithItsRules(id);

        Assert.Equal(2, changed);
        Assert.Equal([null, null], await CategoriesOf(transactionIds));
    }

    [Fact]
    public async Task Delete_WithItsRules_ManuallyCategorizedAndManuallyEnteredTransactionsBecomeUncategorized()
    {
        var id = await CreateCategory($"{_token} Garden");
        var laterId = await CreateCategory($"{_token} Hobby");
        var manual = (await Imported($"{_token} Hageland"))[0];
        await CategorizeManually(manual, id);
        var manuallyEntered = await ManuallyEntered($"{_token} Hageland", id);

        var changed = await TransactionsChangedByDeletingWithItsRules(id);

        Assert.Equal(2, changed);
        Assert.Equal([null, null], await CategoriesOf(manual, manuallyEntered));

        // The imported one is no longer categorized manually, so a matching rule takes it; rules
        // never apply to the manually-entered one.
        await AddedRuleId($"{_token} hageland", laterId);
        Assert.Equal([laterId, null], await CategoriesOf(manual, manuallyEntered));
    }

    [Fact]
    public async Task Delete_WithItsRules_ARemainingRulePicksUpAManuallyCategorizedImportedTransaction()
    {
        var id = await CreateCategory($"{_token} Garden");
        var otherCategoryId = await CreateCategory($"{_token} Home");
        await AddedRuleId($"{_token} plant", otherCategoryId);
        var manual = (await Imported($"{_token} Plantasjen"))[0];
        await CategorizeManually(manual, id);

        var changed = await TransactionsChangedByDeletingWithItsRules(id);

        Assert.Equal(1, changed);
        Assert.Equal([otherCategoryId], await CategoriesOf(manual));
    }

    [Fact]
    public async Task Delete_WithItsRules_TransactionsAiPlacedInOtherGoBackToOther()
    {
        var id = await CreateCategory($"{_token} Garden");
        var transactionId = (await Imported($"{_token} Plantasjen"))[0];
        await PlaceInOther(transactionId);
        await AddedRuleId($"{_token} plantasjen", id);
        Assert.Equal([id], await CategoriesOf(transactionId));

        var changed = await TransactionsChangedByDeletingWithItsRules(id);

        Assert.Equal(1, changed);
        Assert.Equal([OtherId], await CategoriesOf(transactionId));
    }

    [Fact]
    public async Task Delete_WithItsRules_CountsEveryTransactionThatChangedCategoryOnce()
    {
        var id = await CreateCategory($"{_token} Garden");
        var otherCategoryId = await CreateCategory($"{_token} Home");
        await AddedRuleId($"{_token} plant", otherCategoryId);
        var untouched = await Imported($"{_token} Plant Shop");
        var ruleCategorized = await Imported($"{_token} Plantasjen Oslo", $"{_token} Mester Grønn");
        await AddedRuleId($"{_token} plantasjen", id);
        await AddedRuleId($"{_token} mester", id);
        var manual = (await Imported($"{_token} Hageland"))[0];
        await CategorizeManually(manual, id);
        await ManuallyEntered($"{_token} Felleskjøpet", id);

        var changed = await TransactionsChangedByDeletingWithItsRules(id);

        Assert.Equal(4, changed);
        Assert.Equal(
            [otherCategoryId, otherCategoryId, null],
            await CategoriesOf(untouched[0], ruleCategorized[0], ruleCategorized[1]));
    }

    [Fact]
    public async Task Delete_WithItsRulesOfAnUnusedCategory_DeletesItAndChangesNoTransactions()
    {
        var id = await CreateCategory($"{_token} Garden");

        Assert.Equal(0, await TransactionsChangedByDeletingWithItsRules(id));
        Assert.DoesNotContain(await ListCategories(), c => c.Id == id);
    }

    [Fact]
    public async Task Delete_WithItsRules_SpendingCountsItsTransactionsAsUncategorized()
    {
        // Spending adds up every Transaction of a month, so this uses a year no other test uses.
        var id = await CreateCategory($"{_token} Garden");
        var manual = (await ImportedOn(new DateOnly(2091, 5, 3), $"{_token} Hageland"))[0];
        await CategorizeManually(manual, id);
        await ManuallyEntered($"{_token} Felleskjøpet", id, date: "2091-05-04");

        await TransactionsChangedByDeletingWithItsRules(id);

        var spending = await _client.GetFromJsonAsync<SpendingResponse>("/api/spending?year=2091&month=5");
        Assert.Equal(new SpendingSliceResponse(null, 200m), Assert.Single(spending!.Slices));
    }

    [Fact]
    public async Task Delete_WithItsRules_AnUncategorizedManuallyEnteredTransactionIsListedAndCanBeGivenACategory()
    {
        var id = await CreateCategory($"{_token} Garden");
        var transactionId = await ManuallyEntered($"{_token} Felleskjøpet", id);

        await TransactionsChangedByDeletingWithItsRules(id);

        var listed = (await _client.GetFromJsonAsync<List<TransactionResponse>>("/api/transactions?year=2026&month=8"))!
            .Single(t => t.Id == transactionId);
        Assert.Null(listed.CategoryId);
        await CategorizeManually(transactionId, GroceriesId);
        Assert.Equal([GroceriesId], await CategoriesOf(transactionId));
    }

    [Fact]
    public async Task Delete_WithBothAReplacementAndItsRules_IsAValidationProblem()
    {
        var id = await CreateCategory($"{_token} Garden");
        var replacementId = await CreateCategory($"{_token} Home");
        var transactionId = await ManuallyEntered($"{_token} Plantasjen", id);

        var response = await _client.DeleteAsync(
            $"/api/categories/{id}?replacementCategoryId={replacementId}&deleteRules=true");

        await AssertCategoryProblem(
            response, "Choose either a replacement Category or to delete its rules, not both.", key: "deleteRules");
        Assert.Contains(await ListCategories(), c => c.Id == id);
        Assert.Equal([id], await CategoriesOf(transactionId));
    }

    [Fact]
    public async Task Delete_BuiltInCategoryWithItsRules_IsAValidationProblem()
    {
        var id = await CreateCategory($"{_token} Pets", builtIn: true);
        var ruleId = await AddedRuleId($"{_token} dyrebutikk", id);

        var response = await DeleteWithItsRules(id);

        await AssertCategoryProblem(response, $"{_token} Pets is a Built-in Category, so it can't be deleted.");
        Assert.Contains(await ListCategories(), c => c.Id == id);
        Assert.Equal(id, (await Rule(ruleId)).CategoryId);
    }

    private async Task<HttpResponseMessage> EditCategory(int id, string? name, string? description) =>
        await _client.PutAsJsonAsync($"/api/categories/{id}", new { name, description });

    private async Task<Dictionary<string, string[]>> EditCategoryExpectingValidationErrors(
        int id, string? name, string? description)
    {
        var response = await EditCategory(id, name, description);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        return new Dictionary<string, string[]>(problem!.Errors);
    }

    [Fact]
    public async Task Put_NewNameAndDescription_RenamesAndRedescribesTheCategory()
    {
        var id = await CreateCategory($"{_token} Hobby", "Hobbies.");
        var rule = await _client.PostAsJsonAsync(
            "/api/categorization-rules", new { keyword = $"{_token} hobby", categoryId = id });
        Assert.Equal(HttpStatusCode.Created, rule.StatusCode);

        var response = await EditCategory(id, $" {_token} Fritid ", " Hobbies and sports. ");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var expected = new CategoryResponse(
            id, $"{_token} Fritid", "Hobbies and sports.", CategoryColours.Fallback, BuiltIn: false, TransactionCount: 0, RuleCount: 1);
        Assert.Equal(expected, await response.Content.ReadFromJsonAsync<CategoryResponse>());
        Assert.Contains(expected, await ListCategories());
    }

    [Fact]
    public async Task Put_OnlyTheNamesCase_IsAllowed()
    {
        var id = await CreateCategory($"{_token} Hobby", "Hobbies.");

        var response = await EditCategory(id, $"{_token.ToUpperInvariant()} HOBBY", "Hobbies.");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(
            $"{_token.ToUpperInvariant()} HOBBY",
            (await response.Content.ReadFromJsonAsync<CategoryResponse>())!.Name);
    }

    [Fact]
    public async Task Put_MissingNameAndDescription_IsRejectedWithErrorPerField()
    {
        var id = await CreateCategory($"{_token} Hobby", "Hobbies.");

        var errors = await EditCategoryExpectingValidationErrors(id, "  ", null);

        Assert.Equal(["Name is required."], errors["name"]);
        Assert.Equal(["Description is required."], errors["description"]);
    }

    [Fact]
    public async Task Put_TooLongNameAndDescription_IsRejectedWithErrorPerField()
    {
        var id = await CreateCategory($"{_token} Hobby", "Hobbies.");

        var errors = await EditCategoryExpectingValidationErrors(
            id, $"{_token} " + new string('x', 50), new string('x', 201));

        Assert.Equal(["Name must be at most 50 characters."], errors["name"]);
        Assert.Equal(["Description must be at most 200 characters."], errors["description"]);
        Assert.Contains(
            new CategoryResponse(id, $"{_token} Hobby", "Hobbies.", CategoryColours.Fallback, BuiltIn: false, 0, 0),
            await ListCategories());
    }

    [Fact]
    public async Task Put_NameAndDescriptionAtTheirMaximumLength_AreAllowed()
    {
        var id = await CreateCategory($"{_token} Hobby", "Hobbies.");
        var name = $"{_token} ".PadRight(50, 'x');

        var response = await EditCategory(id, name, new string('x', 200));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Put_NameOfAnotherCategoryInDifferentCase_IsRejected()
    {
        await CreateCategory($"{_token} Hobby", "Hobbies.");
        var id = await CreateCategory($"{_token} Sport", "Sports.");

        var errors = await EditCategoryExpectingValidationErrors(
            id, $"{_token.ToUpperInvariant()} HOBBY", "Sports.");

        Assert.Equal([$"A category named '{_token} Hobby' already exists."], errors["name"]);
    }

    [Fact]
    public async Task Put_BuiltInCategoryRenamed_IsRejected()
    {
        var errors = await EditCategoryExpectingValidationErrors(GroceriesId, $"{_token} Food", "All groceries.");

        Assert.Equal(["A Built-in Category can't be renamed."], errors["name"]);
        Assert.Contains(
            (await ListCategories()),
            c => c.Id == GroceriesId && c.Name == "Groceries");
    }

    [Fact]
    public async Task Put_BuiltInCategoryWithItsNameUnchanged_ChangesItsDescription()
    {
        try
        {
            var response = await EditCategory(GroceriesId, "Groceries", $"{_token} Food and drink.");

            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            var edited = await response.Content.ReadFromJsonAsync<CategoryResponse>();
            Assert.Equal(("Groceries", $"{_token} Food and drink.", true), (edited!.Name, edited.Description, edited.BuiltIn));
        }
        finally
        {
            // Other tests assert the seeded description.
            await EditCategory(GroceriesId, "Groceries", "All groceries.");
        }
    }

    [Fact]
    public async Task Put_UnknownCategory_ReturnsNotFound()
    {
        var response = await EditCategory(int.MaxValue, $"{_token} Hobby", "Hobbies.");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    private Task<HttpResponseMessage> AddCategory(string? name, string? description) =>
        _client.PostAsJsonAsync("/api/categories", new { name, description });

    private async Task<CategoryResponse> AddedCategory(string name, string description = "Hobbies.")
    {
        var response = await AddCategory(name, description);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<CategoryResponse>())!;
    }

    private async Task<Dictionary<string, string[]>> AddCategoryExpectingValidationErrors(
        string? name, string? description)
    {
        var response = await AddCategory(name, description);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        return new Dictionary<string, string[]>(problem!.Errors);
    }

    // The colour a Category added now gets: the first of the palette no Category uses, or the
    // fallback once they are all used.
    private async Task<string> NextColour()
    {
        var used = (await ListCategories()).Select(c => c.Colour).ToHashSet();
        return CategoryColours.Palette.FirstOrDefault(c => !used.Contains(c)) ?? CategoryColours.Fallback;
    }

    [Fact]
    public async Task Post_ValidCategory_AddsItAsNotBuiltInAndReturnsCreated()
    {
        var response = await AddCategory($"  {_token} Hobby  ", "  Hobby supplies.  ");

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var added = await response.Content.ReadFromJsonAsync<CategoryResponse>();
        Assert.Equal($"/api/categories/{added!.Id}", response.Headers.Location?.ToString());
        Assert.Equal((Name: $"{_token} Hobby", Description: "Hobby supplies.", BuiltIn: false), (added.Name, added.Description, added.BuiltIn));
        Assert.Equal((0, 0), (added.TransactionCount, added.RuleCount));
        Assert.Equivalent(added, (await ListCategories()).Single(c => c.Id == added.Id));
    }

    [Fact]
    public async Task Post_NewCategories_EachGetTheFirstPaletteColourNoCategoryUses()
    {
        var expectedFirst = await NextColour();
        var first = await AddedCategory($"{_token} Hobby");
        var expectedSecond = await NextColour();
        var second = await AddedCategory($"{_token} Garden");

        Assert.Equal(expectedFirst, first.Colour);
        Assert.Equal(expectedSecond, second.Colour);
        if (expectedSecond != CategoryColours.Fallback)
            Assert.NotEqual(first.Colour, second.Colour);
    }

    [Fact]
    public async Task Post_PaletteUsedUp_GivesTheFallbackAndNeverTheUncategorizedGrey()
    {
        var added = 0;
        while (await NextColour() != CategoryColours.Fallback)
            await AddedCategory($"{_token} Filler {added++}");

        var first = await AddedCategory($"{_token} Hobby");
        var second = await AddedCategory($"{_token} Garden");

        Assert.Equal(CategoryColours.Fallback, first.Colour);
        Assert.Equal(CategoryColours.Fallback, second.Colour);
        Assert.DoesNotContain(CategoryColours.Uncategorized, CategoryColours.Palette);
        Assert.NotEqual(CategoryColours.Uncategorized, CategoryColours.Fallback);
    }

    [Fact]
    public async Task Post_MissingNameAndDescription_ReturnsErrorPerField()
    {
        var errors = await AddCategoryExpectingValidationErrors("   ", null);

        Assert.Equal(["Name is required."], errors["name"]);
        Assert.Equal(["Description is required."], errors["description"]);
    }

    [Fact]
    public async Task Post_TooLongNameAndDescription_ReturnsErrorPerField()
    {
        var errors = await AddCategoryExpectingValidationErrors(
            _token + new string('n', 51 - _token.Length), new string('d', 201));

        Assert.Equal(["Name must be at most 50 characters."], errors["name"]);
        Assert.Equal(["Description must be at most 200 characters."], errors["description"]);
    }

    [Fact]
    public async Task Post_LongestNameAndDescription_AreAccepted()
    {
        var added = await AddedCategory(_token + new string('n', 50 - _token.Length), new string('d', 200));

        Assert.Equal(50, added.Name.Length);
        Assert.Equal(200, added.Description.Length);
    }

    [Fact]
    public async Task Post_NameOfAnotherCategoryIgnoringCase_IsRejected()
    {
        await AddedCategory($"{_token} Hobby");

        var errors = await AddCategoryExpectingValidationErrors($"{_token.ToUpperInvariant()} HOBBY", "Hobbies.");

        Assert.Equal([$"A category named '{_token} Hobby' already exists."], errors["name"]);
    }

    [Fact]
    public async Task Post_NameOfASeededCategoryIgnoringCase_IsRejected()
    {
        var errors = await AddCategoryExpectingValidationErrors("groceries", "Food.");

        Assert.Equal(["A category named 'Groceries' already exists."], errors["name"]);
    }
}
