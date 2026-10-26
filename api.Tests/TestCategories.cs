using System.Net.Http.Json;
using PersonligFinans.Api.Categories;
using PersonligFinans.Api.Data;

namespace PersonligFinans.Api.Tests;

// The ids of the User's Categories that the tests use, found by name through the categories endpoint,
// as the web app does. The seeds are only the Built-in Categories, so the others the tests use are
// added first, through the same endpoint, unless the User already has them. The tests never rely on
// the ids being fixed, since they differ per User once each User has a copy of the seeds of their own.
public sealed record TestCategories(
    int Groceries,
    int Transport,
    int Restaurants,
    int Shopping,
    int Travel,
    int Income,
    int Savings,
    int Other,
    int Clothing,
    int Electronics)
{
    // The Categories the tests use that aren't seeded, each with its description.
    public static readonly IReadOnlyList<(string Name, string Description)> Added =
    [
        ("Restaurants", "Restaurant, takeaway, bakery etc."),
        ("Shopping", "All shopping."),
        ("Travel", "All travel."),
        ("Electronics", "All electronics."),
    ];

    // Every Category a User has once the tests' Categories are added, by name and description.
    public static IEnumerable<(string Name, string Description)> All =>
        Seeds.Categories.Select(c => (c.Name, c.Description)).Concat(Added);

    public static async Task<TestCategories> Of(HttpClient client)
    {
        var ids = await IdsByName(client);
        var missing = Added.Where(category => !ids.ContainsKey(category.Name)).ToList();
        foreach (var (name, description) in missing)
            (await client.PostAsJsonAsync("/api/categories", new { name, description })).EnsureSuccessStatusCode();
        if (missing.Count > 0)
            ids = await IdsByName(client);

        return new TestCategories(
            ids["Groceries"],
            ids["Transport"],
            ids["Restaurants"],
            ids["Shopping"],
            ids["Travel"],
            ids["Income"],
            ids["Savings"],
            ids["Other"],
            ids["Clothing"],
            ids["Electronics"]);
    }

    private static async Task<Dictionary<string, int>> IdsByName(HttpClient client) =>
        (await client.GetFromJsonAsync<List<CategoryResponse>>("/api/categories"))!
            .ToDictionary(c => c.Name, c => c.Id);
}
