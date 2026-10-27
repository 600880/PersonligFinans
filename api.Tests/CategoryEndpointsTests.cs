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
    private readonly PostgresApiFactory _factory;
    private readonly string _email = SignedInClient.UniqueEmail();
    private HttpClient _client = null!;
    private TestCategories _categories = null!;

    public CategoryEndpointsTests(PostgresApiFactory factory)
    {
        _factory = factory;
    }

    public async Task InitializeAsync()
    {
        _client = await _factory.CreateSignedInClientAsync(_email);
        _categories = await TestCategories.Of(_client);
    }

    public Task DisposeAsync() => Task.CompletedTask;

    // Adds a Category straight to the database, and returns its id. Its name must contain the
    // test's token, so that it is removed afterwards.
    private async Task<int> CreateCategory(string name, string description = "Made by a test.", bool builtIn = false)
    {
        await using var user = await UserDatabase.OfAsync(_factory, _email);
        var db = user.Db;
        var category = new Category
        {
            UserId = db.OwnerOfNewRows,
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

    // The Categories of a User of its own, which has only the seeds, since this class's User has the
    // tests' Categories added.
    private async Task<List<CategoryResponse>> ListCategoriesOfANewUser() =>
        (await (await _factory.CreateSignedInClientAsync()).GetFromJsonAsync<List<CategoryResponse>>("/api/categories"))!;

    [Fact]
    public async Task Get_FreshDatabase_ListsTheSeededCategoriesWithDescriptionsAndBuiltInFlags()
    {
        var categories = await ListCategoriesOfANewUser();

        var byName = categories.ToDictionary(c => c.Name);
        Assert.Equal(
            new Dictionary<string, (string, bool)>
            {
                ["Housing"] = ("Mortgage, common costs and insurance.", true),
                ["Groceries"] = ("All groceries.", true),
                ["Clothing"] = ("All clothing, including sportswear.", true),
                ["Income"] = ("All income.", true),
                ["Savings"] = ("Money moved between own accounts.", true),
                ["Transport"] = ("All expenses related to car and public transport.", true),
                ["Other"] = ("Costs that don't belong in any other category.", true),
            },
            byName.ToDictionary(c => c.Key, c => (c.Value.Description, c.Value.BuiltIn)));
    }

    [Fact]
    public async Task Get_FreshDatabase_GivesTheSeededCategoriesTheirColours()
    {
        var colours = (await ListCategoriesOfANewUser()).ToDictionary(c => c.Name, c => c.Colour);

        Assert.Equal(
            new Dictionary<string, string>
            {
                ["Groceries"] = "#2a78d6",
                ["Transport"] = "#1baf7a",
                ["Housing"] = "#eda100",
                ["Income"] = "#8a5a1c",
                ["Savings"] = "#0f766e",
                ["Other"] = "#9085e9",
                ["Clothing"] = "#b8336a",
            },
            colours);
    }

    [Fact]
    public async Task Get_ListsTheBuiltInCategoriesFirstInTheirOrderThenTheRestByName()
    {
        // Created out of order, and named to sort among each other only: in the Norwegian alphabet,
        // ignoring case, Æ, Ø and Å come last.
        string[] created = ["Åa", "Zzz", "øa", "zzy", "Æa"];
        foreach (var name in created)
            await CreateCategory(name);
        string[] builtIns = ["Housing", "Groceries", "Clothing", "Transport", "Other", "Income", "Savings"];

        var categories = await ListCategories();

        Assert.Equal(builtIns, categories.Take(builtIns.Length).Select(c => c.Name));
        Assert.Equal(
            ["zzy", "Zzz", "Æa", "øa", "Åa"],
            categories.Select(c => c.Name).Where(created.Contains));
        Assert.Equal(
            ["Electronics", "Restaurants", "Shopping", "Travel"],
            categories.Select(c => c.Name).Where(name => TestCategories.Added.Any(added => added.Name == name)));
    }

    [Fact]
    public async Task GetPalette_ServesThePaletteInOrderWithoutTheFallbackOrUncategorizedsGrey()
    {
        var palette = await _client.GetFromJsonAsync<List<string>>("/api/categories/palette");

        Assert.Equal(CategoryColours.Palette, palette);
        Assert.DoesNotContain(CategoryColours.Fallback, palette!);
        Assert.DoesNotContain(CategoryColours.Uncategorized, palette!);
    }

    [Fact]
    public async Task GetPalette_SignedOut_IsUnauthorized()
    {
        var response = await _factory.CreateClient().GetAsync("/api/categories/palette");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public void BuiltInOrder_NamesEverySeededBuiltInCategoryOnce()
    {
        Assert.Equal(
            Seeds.Categories.Where(c => c.BuiltIn).Select(c => c.Name).Order(),
            Seeds.BuiltInOrder.Order());
    }

    [Fact]
    public async Task Get_CountsTheTransactionsAndRulesUsingEachCategory()
    {
        var before = (await ListCategories()).ToDictionary(c => c.Id);

        foreach (var description in new[] { "Mobil", "Lader" })
        {
            var transaction = await _client.PostAsJsonAsync("/api/transactions", new
            {
                date = "2026-08-03",
                description,
                amount = -100m,
                categoryId = _categories.Electronics,
            });
            Assert.Equal(HttpStatusCode.Created, transaction.StatusCode);
        }
        var rule = await _client.PostAsJsonAsync(
            "/api/categorization-rules", new { keyword = "elektro", categoryId = _categories.Electronics });
        Assert.Equal(HttpStatusCode.Created, rule.StatusCode);

        var after = (await ListCategories()).ToDictionary(c => c.Id);
        Assert.Equal(before[_categories.Electronics].TransactionCount + 2, after[_categories.Electronics].TransactionCount);
        Assert.Equal(before[_categories.Electronics].RuleCount + 1, after[_categories.Electronics].RuleCount);
        Assert.Equal(before[_categories.Travel].TransactionCount, after[_categories.Travel].TransactionCount);
        Assert.Equal(before[_categories.Travel].RuleCount, after[_categories.Travel].RuleCount);
    }

    [Fact]
    public async Task CategoryNames_AreUniqueIgnoringCase()
    {
        await using var user = await UserDatabase.OfAsync(_factory, _email);
        var db = user.Db;
        db.Categories.Add(new Category { UserId = db.OwnerOfNewRows, Name = "Hobby", Description = "Hobbies.", Colour = CategoryColours.Fallback });
        await db.SaveChangesAsync();

        db.Categories.Add(new Category { UserId = db.OwnerOfNewRows, Name = "HOBBY", Description = "Hobbies.", Colour = CategoryColours.Fallback });

        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task Delete_UnusedCategory_DeletesItAndChangesNoTransactions()
    {
        var id = await CreateCategory("Hobby");

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
        var id = await CreateCategory("Pets", builtIn: true);

        var response = await _client.DeleteAsync($"/api/categories/{id}");

        await AssertCategoryProblem(response, "Pets is a Built-in Category, so it can't be deleted.");
        Assert.Contains(await ListCategories(), c => c.Id == id);
    }

    [Fact]
    public async Task Delete_CategoryATransactionUses_IsAValidationProblem()
    {
        var id = await CreateCategory("Garden");
        var transaction = await _client.PostAsJsonAsync("/api/transactions", new
        {
            date = "2026-08-03",
            description = "Plantasjen",
            amount = -100m,
            categoryId = id,
        });
        Assert.Equal(HttpStatusCode.Created, transaction.StatusCode);

        var response = await _client.DeleteAsync($"/api/categories/{id}");

        await AssertCategoryProblem(response, "Garden is in use, so it can't be deleted.");
        Assert.Contains(await ListCategories(), c => c.Id == id);
    }

    [Fact]
    public async Task Delete_CategoryARuleUses_IsAValidationProblem()
    {
        var id = await CreateCategory("Garden");
        var rule = await _client.PostAsJsonAsync(
            "/api/categorization-rules", new { keyword = "plantasjen", categoryId = id });
        Assert.Equal(HttpStatusCode.Created, rule.StatusCode);

        var response = await _client.DeleteAsync($"/api/categories/{id}");

        await AssertCategoryProblem(response, "Garden is in use, so it can't be deleted.");
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
            .Select(d => new Transaction { UserId = db.OwnerOfNewRows, PostedDate = postedDate, Description = d, Amount = -100m })
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

    private async Task<int> AddedRuleId(string keyword, int categoryId)
    {
        var response = await _client.PostAsJsonAsync("/api/categorization-rules", new { keyword, categoryId });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<SavedCategorizationRuleResponse>())!.Id;
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
        var id = await CreateCategory("Garden");
        var replacementId = await CreateCategory("Home");
        var laterId = await CreateCategory("Hobby");
        var transactionIds = await Imported("Plantasjen Oslo", "Plantasjen Bergen");
        var ruleId = await AddedRuleId("plantasjen", id);

        var changed = await TransactionsChangedByDeleting(id, replacementId);

        Assert.Equal(2, changed);
        Assert.DoesNotContain(await ListCategories(), c => c.Id == id);
        Assert.Equal(replacementId, (await Rule(ruleId)).CategoryId);
        Assert.Equal([replacementId, replacementId], await CategoriesOf(transactionIds));

        // Still categorized by the rule, so they follow it when it changes.
        var edited = await _client.PutAsJsonAsync(
            $"/api/categorization-rules/{ruleId}", new { keyword = "plantasjen", categoryId = laterId });
        Assert.Equal(HttpStatusCode.OK, edited.StatusCode);
        Assert.Equal([laterId, laterId], await CategoriesOf(transactionIds));
    }

    [Fact]
    public async Task Delete_WithReplacement_ManuallyCategorizedTransactionsStayManual()
    {
        var id = await CreateCategory("Garden");
        var replacementId = await CreateCategory("Home");
        var laterId = await CreateCategory("Hobby");
        var transactionId = (await Imported("Plantasjen"))[0];
        var categorized = await _client.PutAsJsonAsync(
            $"/api/transactions/{transactionId}/category", new { categoryId = id });
        Assert.Equal(HttpStatusCode.OK, categorized.StatusCode);

        var changed = await TransactionsChangedByDeleting(id, replacementId);

        Assert.Equal(1, changed);
        Assert.Equal([replacementId], await CategoriesOf(transactionId));

        // A later rule change leaves it alone.
        await AddedRuleId("plantasjen", laterId);
        Assert.Equal([replacementId], await CategoriesOf(transactionId));
    }

    [Fact]
    public async Task Delete_WithReplacement_MovesManuallyEnteredTransactions()
    {
        var id = await CreateCategory("Garden");
        var replacementId = await CreateCategory("Home");
        var transactionId = await ManuallyEntered("Plantasjen", id);

        var changed = await TransactionsChangedByDeleting(id, replacementId);

        Assert.Equal(1, changed);
        Assert.Equal([replacementId], await CategoriesOf(transactionId));
    }

    [Fact]
    public async Task Delete_WithReplacement_CountsEveryMovedTransaction()
    {
        var id = await CreateCategory("Garden");
        var replacementId = await CreateCategory("Home");
        var ruleCategorized = await Imported("Plantasjen Oslo");
        await AddedRuleId("plantasjen", id);
        var manual = (await Imported("Hageland"))[0];
        await _client.PutAsJsonAsync($"/api/transactions/{manual}/category", new { categoryId = id });
        await ManuallyEntered("Felleskjøpet", id);
        var untouched = await ManuallyEntered("Mester Grønn", replacementId);

        var changed = await TransactionsChangedByDeleting(id, replacementId);

        Assert.Equal(3, changed);
        Assert.Equal([replacementId, replacementId], await CategoriesOf(ruleCategorized[0], untouched));
    }

    [Fact]
    public async Task Delete_WithReplacementOtherThanOther_KeepsTheAiMarkOnMovedRules()
    {
        var id = await CreateCategory("Garden");
        var replacementId = await CreateCategory("Home");
        var ruleId = await AddedRuleId("plantasjen", id);
        await MarkAiGenerated(ruleId);

        await TransactionsChangedByDeleting(id, replacementId);

        Assert.Equal(new CategorizationRuleResponse(ruleId, "plantasjen", replacementId, AiGenerated: true, IsNew: false, TransactionCount: 0), await Rule(ruleId));
    }

    [Fact]
    public async Task Delete_WithOtherAsReplacement_KeepsTheAiMarkOnMovedRules()
    {
        var id = await CreateCategory("Garden");
        var aiRuleId = await AddedRuleId("plantasjen", id);
        await MarkAiGenerated(aiRuleId);
        var ordinaryRuleId = await AddedRuleId("hageland", id);
        try
        {
            await TransactionsChangedByDeleting(id, _categories.Other);

            Assert.Equal(new CategorizationRuleResponse(aiRuleId, "plantasjen", _categories.Other, AiGenerated: true, IsNew: false, TransactionCount: 0), await Rule(aiRuleId));
            Assert.Equal(new CategorizationRuleResponse(ordinaryRuleId, "hageland", _categories.Other, AiGenerated: false, IsNew: false, TransactionCount: 0), await Rule(ordinaryRuleId));
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
        var id = await CreateCategory("Garden");
        var replacementId = await CreateCategory("Home");

        Assert.Equal(0, await TransactionsChangedByDeleting(id, replacementId));
        Assert.DoesNotContain(await ListCategories(), c => c.Id == id);
    }

    [Fact]
    public async Task Delete_ReplacementIsTheCategoryItself_IsAValidationProblem()
    {
        var id = await CreateCategory("Garden");
        var transactionId = await ManuallyEntered("Plantasjen", id);

        var response = await DeleteWithReplacement(id, id);

        await AssertCategoryProblem(
            response, "The replacement must be another Category.", key: "replacementCategoryId");
        Assert.Contains(await ListCategories(), c => c.Id == id);
        Assert.Equal([id], await CategoriesOf(transactionId));
    }

    [Fact]
    public async Task Delete_ReplacementDoesNotExist_IsAValidationProblem()
    {
        var id = await CreateCategory("Garden");
        var transactionId = await ManuallyEntered("Plantasjen", id);

        var response = await DeleteWithReplacement(id, int.MaxValue);

        await AssertCategoryProblem(
            response, "The replacement Category does not exist.", key: "replacementCategoryId");
        Assert.Contains(await ListCategories(), c => c.Id == id);
        Assert.Equal([id], await CategoriesOf(transactionId));
    }

    [Fact]
    public async Task Delete_BuiltInCategoryWithReplacement_IsAValidationProblem()
    {
        var id = await CreateCategory("Pets", builtIn: true);
        var replacementId = await CreateCategory("Home");

        var response = await DeleteWithReplacement(id, replacementId);

        await AssertCategoryProblem(response, "Pets is a Built-in Category, so it can't be deleted.");
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

    [Fact]
    public async Task Delete_WithItsRules_DeletesTheRulesAndTheCategory()
    {
        var id = await CreateCategory("Garden");
        var ruleId = await AddedRuleId("plantasjen", id);

        await TransactionsChangedByDeletingWithItsRules(id);

        Assert.DoesNotContain(await ListCategories(), c => c.Id == id);
        Assert.DoesNotContain(
            (await _client.GetFromJsonAsync<List<CategorizationRuleResponse>>("/api/categorization-rules"))!,
            r => r.Id == ruleId);
    }

    [Fact]
    public async Task Delete_WithItsRules_AShorterRemainingRuleForAnotherCategoryPicksUpItsTransactions()
    {
        var id = await CreateCategory("Garden");
        var otherCategoryId = await CreateCategory("Home");
        var transactionIds = await Imported("Plantasjen Oslo", "Plant Shop");
        await AddedRuleId("plant", otherCategoryId);
        await AddedRuleId("plantasjen", id);
        Assert.Equal([id, otherCategoryId], await CategoriesOf(transactionIds));

        var changed = await TransactionsChangedByDeletingWithItsRules(id);

        Assert.Equal(1, changed);
        Assert.Equal([otherCategoryId, otherCategoryId], await CategoriesOf(transactionIds));
    }

    [Fact]
    public async Task Delete_WithItsRules_ImportedTransactionsNoRemainingRuleMatchesBecomeUncategorized()
    {
        var id = await CreateCategory("Garden");
        var transactionIds = await Imported("Plantasjen Oslo", "Plantasjen Bergen");
        await AddedRuleId("plantasjen", id);

        var changed = await TransactionsChangedByDeletingWithItsRules(id);

        Assert.Equal(2, changed);
        Assert.Equal([null, null], await CategoriesOf(transactionIds));
    }

    [Fact]
    public async Task Delete_WithItsRules_ManuallyCategorizedAndManuallyEnteredTransactionsBecomeUncategorized()
    {
        var id = await CreateCategory("Garden");
        var laterId = await CreateCategory("Hobby");
        var manual = (await Imported("Hageland"))[0];
        await CategorizeManually(manual, id);
        var manuallyEntered = await ManuallyEntered("Hageland", id);

        var changed = await TransactionsChangedByDeletingWithItsRules(id);

        Assert.Equal(2, changed);
        Assert.Equal([null, null], await CategoriesOf(manual, manuallyEntered));

        // The imported one is no longer categorized manually, so a matching rule takes it; rules
        // never apply to the manually-entered one.
        await AddedRuleId("hageland", laterId);
        Assert.Equal([laterId, null], await CategoriesOf(manual, manuallyEntered));
    }

    [Fact]
    public async Task Delete_WithItsRules_ARemainingRulePicksUpAManuallyCategorizedImportedTransaction()
    {
        var id = await CreateCategory("Garden");
        var otherCategoryId = await CreateCategory("Home");
        await AddedRuleId("plant", otherCategoryId);
        var manual = (await Imported("Plantasjen"))[0];
        await CategorizeManually(manual, id);

        var changed = await TransactionsChangedByDeletingWithItsRules(id);

        Assert.Equal(1, changed);
        Assert.Equal([otherCategoryId], await CategoriesOf(manual));
    }

    [Fact]
    public async Task Delete_WithItsRules_ManuallyCategorizedImportedTransactionsStopBeingLockedButManuallyEnteredOnesDoNot()
    {
        var id = await CreateCategory("Garden");
        var manual = (await Imported("Plantasjen"))[0];
        await CategorizeManually(manual, id);
        var manuallyEntered = await ManuallyEntered("Felleskjøpet", id);
        var before = await LockedOf(manual, manuallyEntered);

        await TransactionsChangedByDeletingWithItsRules(id);
        var after = await LockedOf(manual, manuallyEntered);

        Assert.Equal([true, true], before);
        Assert.Equal([false, true], after);
    }

    // Whether each Transaction is Locked, as August 2026's list shows it.
    private async Task<bool[]> LockedOf(params int[] transactionIds)
    {
        var transactions = (await _client.GetFromJsonAsync<List<TransactionResponse>>(
            "/api/transactions?year=2026&month=8"))!;
        return transactionIds.Select(id => transactions.Single(t => t.Id == id).Locked).ToArray();
    }

    [Fact]
    public async Task Delete_WithItsRules_CountsEveryTransactionThatChangedCategoryOnce()
    {
        var id = await CreateCategory("Garden");
        var otherCategoryId = await CreateCategory("Home");
        await AddedRuleId("plant", otherCategoryId);
        var untouched = await Imported("Plant Shop");
        var ruleCategorized = await Imported("Plantasjen Oslo", "Mester Grønn");
        await AddedRuleId("plantasjen", id);
        await AddedRuleId("mester", id);
        var manual = (await Imported("Hageland"))[0];
        await CategorizeManually(manual, id);
        await ManuallyEntered("Felleskjøpet", id);

        var changed = await TransactionsChangedByDeletingWithItsRules(id);

        Assert.Equal(4, changed);
        Assert.Equal(
            [otherCategoryId, otherCategoryId, null],
            await CategoriesOf(untouched[0], ruleCategorized[0], ruleCategorized[1]));
    }

    [Fact]
    public async Task Delete_WithItsRulesOfAnUnusedCategory_DeletesItAndChangesNoTransactions()
    {
        var id = await CreateCategory("Garden");

        Assert.Equal(0, await TransactionsChangedByDeletingWithItsRules(id));
        Assert.DoesNotContain(await ListCategories(), c => c.Id == id);
    }

    [Fact]
    public async Task Delete_WithItsRules_SpendingCountsItsTransactionsAsUncategorized()
    {
        var id = await CreateCategory("Garden");
        var manual = (await ImportedOn(new DateOnly(2091, 5, 3), "Hageland"))[0];
        await CategorizeManually(manual, id);
        await ManuallyEntered("Felleskjøpet", id, date: "2091-05-04");

        await TransactionsChangedByDeletingWithItsRules(id);

        var spending = await _client.GetFromJsonAsync<SpendingResponse>("/api/spending?year=2091&month=5");
        Assert.Equal(new SpendingSliceResponse(null, 200m), Assert.Single(spending!.Slices));
    }

    [Fact]
    public async Task Delete_WithItsRules_AnUncategorizedManuallyEnteredTransactionIsListedAndCanBeGivenACategory()
    {
        var id = await CreateCategory("Garden");
        var transactionId = await ManuallyEntered("Felleskjøpet", id);

        await TransactionsChangedByDeletingWithItsRules(id);

        var listed = (await _client.GetFromJsonAsync<List<TransactionResponse>>("/api/transactions?year=2026&month=8"))!
            .Single(t => t.Id == transactionId);
        Assert.Null(listed.CategoryId);
        await CategorizeManually(transactionId, _categories.Groceries);
        Assert.Equal([_categories.Groceries], await CategoriesOf(transactionId));
    }

    [Fact]
    public async Task Delete_WithBothAReplacementAndItsRules_IsAValidationProblem()
    {
        var id = await CreateCategory("Garden");
        var replacementId = await CreateCategory("Home");
        var transactionId = await ManuallyEntered("Plantasjen", id);

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
        var id = await CreateCategory("Pets", builtIn: true);
        var ruleId = await AddedRuleId("dyrebutikk", id);

        var response = await DeleteWithItsRules(id);

        await AssertCategoryProblem(response, "Pets is a Built-in Category, so it can't be deleted.");
        Assert.Contains(await ListCategories(), c => c.Id == id);
        Assert.Equal(id, (await Rule(ruleId)).CategoryId);
    }

    // Leaving the colour out sends none, so the Category keeps its own.
    private async Task<HttpResponseMessage> EditCategory(int id, string? name, string? description, string? colour = null) =>
        await _client.PutAsJsonAsync($"/api/categories/{id}", new { name, description, colour });

    private async Task<Dictionary<string, string[]>> EditCategoryExpectingValidationErrors(
        int id, string? name, string? description, string? colour = null)
    {
        var response = await EditCategory(id, name, description, colour);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        return new Dictionary<string, string[]>(problem!.Errors);
    }

    [Fact]
    public async Task Put_NewNameAndDescription_RenamesAndRedescribesTheCategory()
    {
        var id = await CreateCategory("Hobby", "Hobbies.");
        var rule = await _client.PostAsJsonAsync(
            "/api/categorization-rules", new { keyword = "hobby", categoryId = id });
        Assert.Equal(HttpStatusCode.Created, rule.StatusCode);

        var response = await EditCategory(id, " Fritid ", " Hobbies and sports. ");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var expected = new CategoryResponse(
            id, "Fritid", "Hobbies and sports.", CategoryColours.Fallback, BuiltIn: false, TransactionCount: 0, RuleCount: 1);
        Assert.Equal(expected, await response.Content.ReadFromJsonAsync<CategoryResponse>());
        Assert.Contains(expected, await ListCategories());
    }

    [Fact]
    public async Task Put_OnlyTheNamesCase_IsAllowed()
    {
        var id = await CreateCategory("Hobby", "Hobbies.");

        var response = await EditCategory(id, "HOBBY", "Hobbies.");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(
            "HOBBY",
            (await response.Content.ReadFromJsonAsync<CategoryResponse>())!.Name);
    }

    [Fact]
    public async Task Put_MissingNameAndDescription_IsRejectedWithErrorPerField()
    {
        var id = await CreateCategory("Hobby", "Hobbies.");

        var errors = await EditCategoryExpectingValidationErrors(id, "  ", null);

        Assert.Equal(["Name is required."], errors["name"]);
        Assert.Equal(["Description is required."], errors["description"]);
    }

    [Fact]
    public async Task Put_TooLongNameAndDescription_IsRejectedWithErrorPerField()
    {
        var id = await CreateCategory("Hobby", "Hobbies.");

        var errors = await EditCategoryExpectingValidationErrors(
            id, new string('x', 51), new string('x', 201));

        Assert.Equal(["Name must be at most 50 characters."], errors["name"]);
        Assert.Equal(["Description must be at most 200 characters."], errors["description"]);
        Assert.Contains(
            new CategoryResponse(id, "Hobby", "Hobbies.", CategoryColours.Fallback, BuiltIn: false, 0, 0),
            await ListCategories());
    }

    [Fact]
    public async Task Put_NameAndDescriptionAtTheirMaximumLength_AreAllowed()
    {
        var id = await CreateCategory("Hobby", "Hobbies.");
        var name = "".PadRight(50, 'x');

        var response = await EditCategory(id, name, new string('x', 200));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Put_NameOfAnotherCategoryInDifferentCase_IsRejected()
    {
        await CreateCategory("Hobby", "Hobbies.");
        var id = await CreateCategory("Sport", "Sports.");

        var errors = await EditCategoryExpectingValidationErrors(
            id, "HOBBY", "Sports.");

        Assert.Equal(["A category named 'Hobby' already exists."], errors["name"]);
    }

    [Fact]
    public async Task Put_BuiltInCategoryRenamed_IsRejected()
    {
        var errors = await EditCategoryExpectingValidationErrors(_categories.Groceries, "Food", "All groceries.");

        Assert.Equal(["A Built-in Category can't be renamed."], errors["name"]);
        Assert.Contains(
            (await ListCategories()),
            c => c.Id == _categories.Groceries && c.Name == "Groceries");
    }

    [Fact]
    public async Task Put_BuiltInCategoryWithItsNameUnchanged_ChangesItsDescription()
    {
        var response = await EditCategory(_categories.Groceries, "Groceries", "Food and drink.");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var edited = await response.Content.ReadFromJsonAsync<CategoryResponse>();
        Assert.Equal(("Groceries", "Food and drink.", true), (edited!.Name, edited.Description, edited.BuiltIn));
    }

    [Fact]
    public async Task Put_UnknownCategory_ReturnsNotFound()
    {
        var response = await EditCategory(int.MaxValue, "Hobby", "Hobbies.");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // Leaving the colour out sends none, so the Category gets the first unused palette colour.
    private Task<HttpResponseMessage> AddCategory(string? name, string? description, string? colour = null) =>
        _client.PostAsJsonAsync("/api/categories", new { name, description, colour });

    private async Task<CategoryResponse> AddedCategory(string name, string description = "Hobbies.", string? colour = null)
    {
        var response = await AddCategory(name, description, colour);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<CategoryResponse>())!;
    }

    private async Task<Dictionary<string, string[]>> AddCategoryExpectingValidationErrors(
        string? name, string? description, string? colour = null)
    {
        var response = await AddCategory(name, description, colour);
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
        var response = await AddCategory("  Hobby  ", "  Hobby supplies.  ");

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var added = await response.Content.ReadFromJsonAsync<CategoryResponse>();
        Assert.Equal($"/api/categories/{added!.Id}", response.Headers.Location?.ToString());
        Assert.Equal((Name: "Hobby", Description: "Hobby supplies.", BuiltIn: false), (added.Name, added.Description, added.BuiltIn));
        Assert.Equal((0, 0), (added.TransactionCount, added.RuleCount));
        Assert.Equivalent(added, (await ListCategories()).Single(c => c.Id == added.Id));
    }

    [Fact]
    public async Task Post_NewCategories_EachGetTheFirstPaletteColourNoCategoryUses()
    {
        var expectedFirst = await NextColour();
        var first = await AddedCategory("Hobby");
        var expectedSecond = await NextColour();
        var second = await AddedCategory("Garden");

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
            await AddedCategory($"Filler {added++}");

        var first = await AddedCategory("Hobby");
        var second = await AddedCategory("Garden");

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
            new string('n', 51), new string('d', 201));

        Assert.Equal(["Name must be at most 50 characters."], errors["name"]);
        Assert.Equal(["Description must be at most 200 characters."], errors["description"]);
    }

    [Fact]
    public async Task Post_LongestNameAndDescription_AreAccepted()
    {
        var added = await AddedCategory(new string('n', 50), new string('d', 200));

        Assert.Equal(50, added.Name.Length);
        Assert.Equal(200, added.Description.Length);
    }

    [Fact]
    public async Task Post_NameOfAnotherCategoryIgnoringCase_IsRejected()
    {
        await AddedCategory("Hobby");

        var errors = await AddCategoryExpectingValidationErrors("HOBBY", "Hobbies.");

        Assert.Equal(["A category named 'Hobby' already exists."], errors["name"]);
    }

    [Fact]
    public async Task Post_NameOfASeededCategoryIgnoringCase_IsRejected()
    {
        var errors = await AddCategoryExpectingValidationErrors("groceries", "Food.");

        Assert.Equal(["A category named 'Groceries' already exists."], errors["name"]);
    }

    [Fact]
    public async Task Post_WithAPaletteColour_GivesItThatColourEvenIfAnotherCategoryHasIt()
    {
        var groceries = (await ListCategories()).Single(c => c.Id == _categories.Groceries).Colour;

        var added = await AddedCategory("Hobby", colour: groceries);

        Assert.Equal(groceries, added.Colour);
        Assert.Equal(groceries, (await ListCategories()).Single(c => c.Id == added.Id).Colour);
    }

    // Neither the fallback nor Uncategorized's grey is a palette colour, so neither can be chosen.
    [Theory]
    [InlineData("#123456")]
    [InlineData("blue")]
    [InlineData("")]
    [InlineData(CategoryColours.Fallback)]
    [InlineData(CategoryColours.Uncategorized)]
    public async Task Post_ColourOutsideThePalette_IsAFieldErrorOnColour(string colour)
    {
        var errors = await AddCategoryExpectingValidationErrors("Hobby", "Hobbies.", colour);

        Assert.Equal(["Colour must be one of the palette's colours."], errors["colour"]);
        Assert.DoesNotContain(await ListCategories(), c => c.Name == "Hobby");
    }

    [Fact]
    public async Task Put_PaletteColour_RecoloursTheCategory()
    {
        var id = await CreateCategory("Hobby", "Hobbies.");

        var response = await EditCategory(id, "Hobby", "Hobbies.", CategoryColours.Palette[4]);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var expected = new CategoryResponse(id, "Hobby", "Hobbies.", CategoryColours.Palette[4], BuiltIn: false, 0, 0);
        Assert.Equal(expected, await response.Content.ReadFromJsonAsync<CategoryResponse>());
        Assert.Contains(expected, await ListCategories());
    }

    [Fact]
    public async Task Put_BuiltInCategory_CanBeRecolouredToAnotherCategorysColour()
    {
        var colours = (await ListCategories()).ToDictionary(c => c.Id, c => c.Colour);
        var transport = colours[_categories.Transport];

        var response = await EditCategory(_categories.Groceries, "Groceries", "All groceries.", transport);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var recoloured = (await ListCategories()).ToDictionary(c => c.Id, c => c.Colour);
        Assert.NotEqual(transport, colours[_categories.Groceries]);
        Assert.Equal((transport, transport), (recoloured[_categories.Groceries], recoloured[_categories.Transport]));
    }

    [Fact]
    public async Task Put_NoColour_KeepsTheCategorysColour()
    {
        var id = await CreateCategory("Hobby", "Hobbies.");

        var response = await EditCategory(id, "Hobby", "Hobbies and sports.");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(CategoryColours.Fallback, (await response.Content.ReadFromJsonAsync<CategoryResponse>())!.Colour);
    }

    [Fact]
    public async Task Put_ColourOutsideThePalette_IsAFieldErrorOnColourAndChangesNothing()
    {
        var id = await CreateCategory("Hobby", "Hobbies.");

        var errors = await EditCategoryExpectingValidationErrors(
            id, "Hobby", "Hobbies and sports.", CategoryColours.Uncategorized);

        Assert.Equal(["Colour must be one of the palette's colours."], errors["colour"]);
        Assert.Contains(
            new CategoryResponse(id, "Hobby", "Hobbies.", CategoryColours.Fallback, BuiltIn: false, 0, 0),
            await ListCategories());
    }
}
