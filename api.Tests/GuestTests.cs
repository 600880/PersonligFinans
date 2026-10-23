using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using PersonligFinans.Api.BankStatements;
using PersonligFinans.Api.Categories;
using PersonligFinans.Api.CategorizationRules;
using PersonligFinans.Api.Data;
using PersonligFinans.Api.Transactions;
using PersonligFinans.Api.Users;

namespace PersonligFinans.Api.Tests;

// The Guest: the one User anyone can sign in as without signing up, so every visitor who continues
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
    public async Task AUserWhoSignedUp_IsNotTheGuest()
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
    public async Task TheGuestsData_IsSeparateFromThatOfAUserWhoSignedUp()
    {
        var guest = await _factory.CreateGuestClientAsync();
        var signedUp = await _factory.CreateSignedInClientAsync();
        var guestsName = UniqueName();
        var signedUpName = UniqueName();

        await AddCategory(guest, guestsName);
        await AddCategory(signedUp, signedUpName);

        Assert.DoesNotContain(signedUpName, await CategoryNames(guest));
        Assert.DoesNotContain(guestsName, await CategoryNames(signedUp));
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

    // So any visitor can wipe the Guest and try the app again from the start.
    [Fact]
    public async Task TheGuest_CanDeleteAllTransactions()
    {
        var guest = await _factory.CreateGuestClientAsync();
        var file = new ByteArrayContent(StatementPdf.WithPurchasesFrom("Kafé"));
        file.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
        using var form = new MultipartFormDataContent { { file, "file", "kontoutskrift.pdf" } };
        Assert.Equal(HttpStatusCode.Created, (await guest.PostAsync("/api/bank-statements", form)).StatusCode);

        var response = await guest.DeleteAsync("/api/transactions");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Empty((await guest.GetFromJsonAsync<List<TransactionMonthResponse>>("/api/transactions/months"))!);
        Assert.Empty((await guest.GetFromJsonAsync<List<ListedBankStatementResponse>>("/api/bank-statements"))!);
    }

    [Fact]
    public async Task TheGuest_CanDeleteAllRules()
    {
        var guest = await _factory.CreateGuestClientAsync();

        var response = await guest.DeleteAsync("/api/categorization-rules");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Empty((await guest.GetFromJsonAsync<List<CategorizationRuleResponse>>("/api/categorization-rules"))!);
    }
}
