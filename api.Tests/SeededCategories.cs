using System.Net.Http.Json;
using PersonligFinans.Api.Categories;

namespace PersonligFinans.Api.Tests;

// The ids of a User's seeded Categories that the tests use, found by name through the categories
// endpoint, as the web app does. The tests never rely on the ids being fixed, since they differ per
// User once each User has a copy of the seeds of their own.
public sealed record SeededCategories(
    int Groceries,
    int Restaurants,
    int Shopping,
    int Travel,
    int Income,
    int Transfers,
    int Other,
    int Clothing,
    int Electronics)
{
    public static async Task<SeededCategories> Of(HttpClient client)
    {
        var ids = (await client.GetFromJsonAsync<List<CategoryResponse>>("/api/categories"))!
            .ToDictionary(c => c.Name, c => c.Id);
        return new SeededCategories(
            ids["Groceries"],
            ids["Restaurants"],
            ids["Shopping"],
            ids["Travel"],
            ids["Income"],
            ids["Transfers"],
            ids["Other"],
            ids["Clothing"],
            ids["Electronics"]);
    }
}
