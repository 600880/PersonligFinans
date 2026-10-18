using System.Net.Http.Json;
using PersonligFinans.Api.Categories;
using PersonligFinans.Api.Data;

namespace PersonligFinans.Api.Tests;

// Finds the seeded Categories' ids by name, through the categories endpoint, as the web app does.
// The tests never rely on the ids being fixed, since they differ per User once each User has a
// copy of the seeds of their own.
public static class SeededCategoryIds
{
    public static async Task<IReadOnlyDictionary<string, int>> SeededCategoryIdsByName(this HttpClient client)
    {
        var categories = (await client.GetFromJsonAsync<List<CategoryResponse>>("/api/categories"))!;
        return SeedCategories.All.ToDictionary(s => s.Name, s => categories.Single(c => c.Name == s.Name).Id);
    }
}
