using System.Net;
using System.Net.Http.Json;
using PersonligFinans.Api.Categories;
using PersonligFinans.Api.Data;
using PersonligFinans.Api.Users;

namespace PersonligFinans.Api.Tests;

// The Guest: the one User anyone can sign in as without registering, so every visitor who continues
// as the Guest sees and changes the same data. Every test here shares that one Guest, with each
// other and with any other test class, so each names what it adds uniquely.
[Collection(ApiCollection.Name)]
public class GuestTests
{
    private readonly PostgresApiFactory _factory;

    public GuestTests(PostgresApiFactory factory)
    {
        _factory = factory;
    }

    // A Category name no other test adds.
    private static string UniqueName() => $"Guest {Guid.NewGuid():N}";

    private static async Task AddCategory(HttpClient client, string name)
    {
        var response = await client.PostAsJsonAsync("/api/categories", new { name, description = "Made by a test." });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    private static async Task<List<string>> CategoryNames(HttpClient client) =>
        (await client.GetFromJsonAsync<List<CategoryResponse>>("/api/categories"))!.Select(c => c.Name).ToList();

    [Fact]
    public async Task ContinueAsGuest_SignsInAsTheGuest()
    {
        var client = _factory.CreateClient();

        var response = await client.PostAsJsonAsync("/api/user/continue-as-guest", new { });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(new UserResponse(Guest.Email, IsGuest: true), await response.Content.ReadFromJsonAsync<UserResponse>());
        Assert.Equal(new UserResponse(Guest.Email, IsGuest: true), await client.GetFromJsonAsync<UserResponse>("/api/user"));
    }

    // What another site's form would send, to sign whoever visits it in as the Guest.
    [Fact]
    public async Task ContinueAsGuest_FromAForm_IsRefused()
    {
        var client = _factory.CreateClient();

        var response = await client.PostAsync("/api/user/continue-as-guest", new FormUrlEncodedContent([]));

        Assert.Equal(HttpStatusCode.UnsupportedMediaType, response.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/user")).StatusCode);
    }

    [Fact]
    public async Task ARegisteredUser_IsNotTheGuest()
    {
        var client = await _factory.CreateSignedInClientAsync();

        var whoAmI = await client.GetFromJsonAsync<UserResponse>("/api/user");

        Assert.False(whoAmI!.IsGuest);
    }

    [Fact]
    public async Task TwoVisitorsContinuingAsGuest_SeeTheSameData()
    {
        var first = await _factory.CreateGuestClientAsync();
        var second = await _factory.CreateGuestClientAsync();
        var name = UniqueName();

        await AddCategory(first, name);

        Assert.Contains(name, await CategoryNames(second));
    }

    [Fact]
    public async Task TheGuestsData_IsSeparateFromARegisteredUsers()
    {
        var guest = await _factory.CreateGuestClientAsync();
        var registered = await _factory.CreateSignedInClientAsync();
        var guestsName = UniqueName();
        var registeredName = UniqueName();

        await AddCategory(guest, guestsName);
        await AddCategory(registered, registeredName);

        Assert.DoesNotContain(registeredName, await CategoryNames(guest));
        Assert.DoesNotContain(guestsName, await CategoryNames(registered));
    }

    [Fact]
    public async Task Restarting_NeitherResetsNorDuplicatesTheGuest()
    {
        var name = UniqueName();
        await AddCategory(await _factory.CreateGuestClientAsync(), name);

        // A second app on the same database, starting up as after a deployment.
        await using var restarted = _factory.WithWebHostBuilder(_ => { });
        var names = await CategoryNames(await restarted.CreateGuestClientAsync());

        Assert.Contains(name, names);
        // Started like a new User once: each seeded Category, and only once.
        foreach (var seed in Seeds.Categories)
            Assert.Single(names, seed.Name);
    }
}
