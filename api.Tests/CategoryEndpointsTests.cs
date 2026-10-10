using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PersonligFinans.Api.Categories;
using PersonligFinans.Api.Data;

namespace PersonligFinans.Api.Tests;

[Collection(ApiCollection.Name)]
public class CategoryEndpointsTests
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

        Assert.Equal([$"A Category named '{_token} Hobby' already exists."], errors["name"]);
    }

    [Fact]
    public async Task Post_NameOfASeededCategoryIgnoringCase_IsRejected()
    {
        var errors = await AddCategoryExpectingValidationErrors("groceries", "Food.");

        Assert.Equal(["A Category named 'Groceries' already exists."], errors["name"]);
    }
}
