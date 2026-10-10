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
    private const int GroceriesId = 1;
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

    public Task InitializeAsync() => Task.CompletedTask;

    // Removes the Categories the test created, and their rules, since other tests expect only the
    // seeded Categories, e.g. among those offered to the rule generator.
    public async Task DisposeAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var created = db.Categories.Where(c => c.Name.ToLower().Contains(_token));
        await db.CategorizationRules.Where(r => created.Any(c => c.Id == r.CategoryId)).ExecuteDeleteAsync();
        await created.ExecuteDeleteAsync();
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

    // Adds a Category directly through the database, since the tests may only edit Categories
    // they created themselves.
    private async Task<int> CreateCategory(string name, string description)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var category = new Category { Name = name, Description = description };
        db.Categories.Add(category);
        await db.SaveChangesAsync();
        return category.Id;
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
            id, $"{_token} Fritid", "Hobbies and sports.", BuiltIn: false, TransactionCount: 0, RuleCount: 1);
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
            new CategoryResponse(id, $"{_token} Hobby", "Hobbies.", BuiltIn: false, 0, 0),
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
}
