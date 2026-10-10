using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PersonligFinans.Api.Categories;
using PersonligFinans.Api.Data;

namespace PersonligFinans.Api.Tests;

[Collection(ApiCollection.Name)]
public class CategoryEndpointsTests : IAsyncLifetime
{
    private const int TravelId = 10;
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

    // The Categories this test created, removed afterwards with whatever still uses them, so that
    // the other tests see only the seeded Categories.
    private readonly List<int> _createdCategoryIds = [];

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Transactions.Where(t => _createdCategoryIds.Contains(t.CategoryId!.Value)).ExecuteDeleteAsync();
        await db.CategorizationRules.Where(r => _createdCategoryIds.Contains(r.CategoryId)).ExecuteDeleteAsync();
        await db.Categories.Where(c => _createdCategoryIds.Contains(c.Id)).ExecuteDeleteAsync();
    }

    // Adds a Category straight to the database, and returns its id.
    private async Task<int> CreateCategory(string name, bool builtIn = false)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var category = new Category { Name = $"{_token} {name}", Description = "Made by a test.", BuiltIn = builtIn };
        db.Categories.Add(category);
        await db.SaveChangesAsync();
        _createdCategoryIds.Add(category.Id);
        return category.Id;
    }

    private async Task<List<CategoryResponse>> ListCategories() =>
        (await _client.GetFromJsonAsync<List<CategoryResponse>>("/api/categories"))!;

    [Fact]
    public async Task Get_FreshDatabase_ListsTheSeededCategoriesWithDescriptionsAndBuiltInFlags()
    {
        var categories = await ListCategories();

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
        db.Categories.Add(new Category { Name = $"{_token} Hobby", Description = "Hobbies." });
        await db.SaveChangesAsync();

        db.Categories.Add(new Category { Name = $"{_token.ToUpperInvariant()} HOBBY", Description = "Hobbies." });

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

        await AssertCategoryProblem(response, $"{_token} Pets is a Built-in Category, so it can't be deleted.");
        Assert.Contains(await ListCategories(), c => c.Id == id);
    }

    [Fact]
    public async Task Delete_CategoryATransactionUses_IsAValidationProblem()
    {
        var id = await CreateCategory("Garden");
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
        var id = await CreateCategory("Garden");
        var rule = await _client.PostAsJsonAsync(
            "/api/categorization-rules", new { keyword = $"{_token} plantasjen", categoryId = id });
        Assert.Equal(HttpStatusCode.Created, rule.StatusCode);

        var response = await _client.DeleteAsync($"/api/categories/{id}");

        await AssertCategoryProblem(response, $"{_token} Garden is in use, so it can't be deleted.");
        Assert.Contains(await ListCategories(), c => c.Id == id);
    }

    private static async Task AssertCategoryProblem(HttpResponseMessage response, string message)
    {
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        Assert.Equal([message], problem!.Errors["category"]);
    }
}
