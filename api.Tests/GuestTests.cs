using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
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
    public async Task ContinuingAsTheGuest_RestoresItToTheGuestSnapshot()
    {
        var earlier = await _factory.CreateGuestClientAsync();
        await AddCategory(earlier, UniqueName());
        Assert.Equal(HttpStatusCode.OK, (await earlier.DeleteAsync("/api/transactions")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await earlier.DeleteAsync("/api/categorization-rules")).StatusCode);

        await _factory.CreateGuestClientAsync();

        await AssertHoldsTheGuestSnapshot(_factory);
    }

    // Whoever was already using the Guest stays signed in, and sees the restored data.
    [Fact]
    public async Task AVisitorAlreadyUsingTheGuest_SeesWhatAnotherVisitorsContinuingRestored()
    {
        var earlier = await _factory.CreateGuestClientAsync();
        var name = UniqueName();
        await AddCategory(earlier, name);

        await _factory.CreateGuestClientAsync();

        Assert.Equal(new UserResponse(Guest.Email, IsGuest: true), await earlier.GetFromJsonAsync<UserResponse>("/api/user"));
        Assert.DoesNotContain(name, await CategoryNames(earlier));
    }

    [Fact]
    public async Task Restarting_RestoresTheGuestWithoutDuplicatingIt()
    {
        var guest = await _factory.CreateGuestClientAsync();
        await AddCategory(guest, UniqueName());

        // A second app on the same database, starting up as after a deployment.
        await using var restarted = _factory.WithWebHostBuilder(_ => { });
        _ = restarted.Server;

        await AssertHoldsTheGuestSnapshot(_factory);
    }

    // An API on the given clock, Restoring the Guest at most once every 20 minutes. Its start-up
    // Restores the Guest at the clock's time.
    private async Task<WebApplicationFactory<Program>> ApiWithCooldown(FakeClock clock)
    {
        var api = _factory.WithWebHostBuilder(builder =>
        {
            builder.UseSetting($"{GuestRestore.SectionName}:{nameof(GuestRestore.CooldownMinutes)}", "20");
            builder.ConfigureTestServices(services => services.AddSingleton<TimeProvider>(clock));
        });
        _ = api.Server;
        return api;
    }

    // In 2099, as the sign-in cookie is set on the same clock, and the test client would throw away
    // one that has expired by its own, real clock.
    private static FakeClock ClockIn2099() => new(new DateTimeOffset(2099, 6, 1, 12, 0, 0, TimeSpan.Zero));

    // So that a flood of visitors can't keep the Guest Restoring, which every User's rule changes wait
    // for.
    [Fact]
    public async Task ContinuingAsTheGuest_WithinTheCooldown_DoesNotRestoreIt()
    {
        var clock = ClockIn2099();
        await using var api = await ApiWithCooldown(clock);
        var name = UniqueName();
        await AddCategory(await api.CreateGuestClientAsync(), name);

        clock.Now += TimeSpan.FromMinutes(19);
        var later = await api.CreateGuestClientAsync();

        Assert.Contains(name, await CategoryNames(later));
    }

    [Fact]
    public async Task ContinuingAsTheGuest_OnceTheCooldownIsOver_RestoresIt()
    {
        var clock = ClockIn2099();
        await using var api = await ApiWithCooldown(clock);
        await AddCategory(await api.CreateGuestClientAsync(), UniqueName());

        clock.Now += TimeSpan.FromMinutes(20);
        await api.CreateGuestClientAsync();

        await AssertHoldsTheGuestSnapshot(_factory);
    }

    // Or anyone could get a fresh Daily AI limit by continuing as the Guest again.
    [Fact]
    public async Task Restoring_KeepsTheGuestsAiRequests()
    {
        await using var scope = _factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var guestId = (await scope.ServiceProvider.GetRequiredService<UserManager<IdentityUser>>().FindByEmailAsync(Guest.Email))!.Id;
        var request = new AiRequest { UserId = guestId, MadeAt = DateTimeOffset.UtcNow };
        db.AiRequests.Add(request);
        await db.SaveChangesAsync();

        await _factory.CreateGuestClientAsync();

        Assert.True(await db.AiRequests.AnyAsync(r => r.Id == request.Id && r.UserId == guestId));
    }

    // That the Guest holds exactly the Guest snapshot: every row, and every mark on them.
    private static async Task AssertHoldsTheGuestSnapshot(PostgresApiFactory factory)
    {
        var snapshot = GuestSnapshot.Read();
        await using var guest = await UserDatabase.OfAsync(factory, Guest.Email);
        var db = guest.Db;

        Assert.Equal(
            snapshot.Categories.Select(c => (c.Name, c.Description, c.Colour, c.BuiltIn)).Order(),
            (await db.Categories.ToListAsync()).Select(c => (c.Name, c.Description, c.Colour, c.BuiltIn)).Order());
        Assert.Equal(
            snapshot.Rules.Select(r => (r.Keyword, r.Category, r.AiGenerated, r.UploadId)).Order(),
            (await db.CategorizationRules.Include(r => r.Category).ToListAsync())
                .Select(r => (r.Keyword, r.Category!.Name, r.AiGenerated, r.UploadId)).Order());
        Assert.Equal(
            snapshot.BankStatements.Select(s => (s.AccountNumber, s.PeriodStart, s.PeriodEnd, s.Transactions.Count)).Order(),
            (await db.BankStatements.Select(s => new { s.AccountNumber, s.PeriodStart, s.PeriodEnd, s.Transactions.Count }).ToListAsync())
                .Select(s => (s.AccountNumber, s.PeriodStart, s.PeriodEnd, s.Count)).Order());

        var expected = snapshot.BankStatements.SelectMany(s => s.Transactions.Select(t => (Imported: true, t)))
            .Concat(snapshot.ManualTransactions.Select(t => (Imported: false, t)))
            .Select(x => (x.Imported, x.t.PostedDate, x.t.Description, x.t.Amount, x.t.Note, x.t.Category, x.t.Rule,
                Bookmarked: x.t.Bookmark is not null, Folder: x.t.Bookmark?.Folder, HasReceipt: x.t.Receipt is not null));
        var bookmarks = await db.Bookmarks.ToDictionaryAsync(b => b.TransactionId, b => b.FolderId);
        var folders = await db.Folders.ToDictionaryAsync(f => f.Id, f => f.Name);
        var receipts = await db.Receipts.Select(r => r.TransactionId).ToListAsync();
        var actual = (await db.Transactions.Include(t => t.Category).Include(t => t.CategorizationRule).ToListAsync())
            .Select(t => (t.IsImported, t.PostedDate, t.Description, t.Amount, t.Note, t.Category?.Name, t.CategorizationRule?.Keyword,
                Bookmarked: bookmarks.ContainsKey(t.Id),
                Folder: bookmarks.GetValueOrDefault(t.Id) is { } folderId ? folders[folderId] : null,
                HasReceipt: receipts.Contains(t.Id)));
        Assert.Equal(expected.Order(), actual.Order());

        Assert.Equal(snapshot.Folders.Order(), folders.Values.Order());
        Assert.Equal(
            snapshot.LastUsedFolder,
            await db.LastUsedFolders.Select(l => l.FolderId).SingleOrDefaultAsync() is { } lastUsed ? folders[lastUsed] : null);
        Assert.Equal(snapshot.LatestUploadId, await db.LatestUploads.Select(l => (Guid?)l.UploadId).SingleOrDefaultAsync());
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
