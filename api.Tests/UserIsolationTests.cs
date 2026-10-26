using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PersonligFinans.Api.BankStatements;
using PersonligFinans.Api.Bookmarks;
using PersonligFinans.Api.Categories;
using PersonligFinans.Api.CategorizationRules;
using PersonligFinans.Api.Data;
using PersonligFinans.Api.Folders;
using PersonligFinans.Api.Receipts;
using PersonligFinans.Api.Spending;
using PersonligFinans.Api.Transactions;
using PersonligFinans.Api.Users;

namespace PersonligFinans.Api.Tests;

// Two Users side by side: each has their own Transactions, Bank Statements, Uploads, Categories,
// Categorization Rules, Bookmarks, Receipts and Folders, and never sees or changes the other's.
[Collection(ApiCollection.Name)]
public class UserIsolationTests : IAsyncLifetime
{
    private readonly PostgresApiFactory _factory;
    private readonly string _emailA = SignedInClient.UniqueEmail();
    private readonly string _emailB = SignedInClient.UniqueEmail();
    private HttpClient _a = null!;
    private HttpClient _b = null!;
    private TestCategories _categoriesA = null!;
    private TestCategories _categoriesB = null!;

    public UserIsolationTests(PostgresApiFactory factory)
    {
        _factory = factory;
    }

    public async Task InitializeAsync()
    {
        _a = await _factory.CreateSignedInClientAsync(_emailA);
        _b = await _factory.CreateSignedInClientAsync(_emailB);
        _categoriesA = await TestCategories.Of(_a);
        _categoriesB = await TestCategories.Of(_b);
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private static async Task<int> AddTransaction(HttpClient client, int categoryId, string description = "Kafé Sentrum")
    {
        var response = await client.PostAsJsonAsync("/api/transactions", new
        {
            date = "2026-08-03",
            description,
            amount = -100m,
            categoryId,
        });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<TransactionResponse>())!.Id;
    }

    private static async Task<int> AddCategory(HttpClient client, string name)
    {
        var response = await client.PostAsJsonAsync("/api/categories", new { name, description = "Made by a test." });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<CategoryResponse>())!.Id;
    }

    private static Task<HttpResponseMessage> PostRule(HttpClient client, string keyword, int categoryId) =>
        client.PostAsJsonAsync("/api/categorization-rules", new { keyword, categoryId });

    private static async Task<SavedCategorizationRuleResponse> AddRule(HttpClient client, string keyword, int categoryId)
    {
        var response = await PostRule(client, keyword, categoryId);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<SavedCategorizationRuleResponse>())!;
    }

    private static async Task<List<TransactionResponse>> August(HttpClient client) =>
        (await client.GetFromJsonAsync<List<TransactionResponse>>("/api/transactions?year=2026&month=8"))!;

    private static async Task<List<CategoryResponse>> Categories(HttpClient client) =>
        (await client.GetFromJsonAsync<List<CategoryResponse>>("/api/categories"))!;

    private static async Task<List<CategorizationRuleResponse>> Rules(HttpClient client) =>
        (await client.GetFromJsonAsync<List<CategorizationRuleResponse>>("/api/categorization-rules"))!;

    // A one-row Bank Statement for August 2026 of the given account, whose row has the description.
    private static byte[] Statement(string accountNumber, string description = "Varer 03.08 Kafé Sentrum") =>
        StatementPdf.Create(
            accountNumber,
            period: "01.08.2026 - 31.08.2026",
            openingBalance: "1.000,00",
            rows: [new(description, "0308", "100,00", null, "0308", "21", "12345678")],
            closingBalance: "900,00");

    private static async Task<HttpResponseMessage> Upload(HttpClient client, byte[] pdf)
    {
        var file = new ByteArrayContent(pdf);
        file.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
        using var form = new MultipartFormDataContent { { file, "file", "kontoutskrift.pdf" } };
        return await client.PostAsync("/api/bank-statements", form);
    }

    // Uploads the Bank Statement, which must import, and returns its id.
    private static async Task<int> Import(HttpClient client, byte[] pdf)
    {
        var response = await Upload(client, pdf);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<BankStatementResponse>())!.Id;
    }

    private static async Task<Dictionary<string, string[]>> ValidationErrors(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        return new((await response.Content.ReadFromJsonAsync<ValidationProblemDetails>())!.Errors);
    }

    private static string AccountNumber()
    {
        var digits = Random.Shared.NextInt64(0, 100_000_000_000).ToString("D11");
        return $"{digits[..4]}.{digits[4..6]}.{digits[6..]}";
    }

    [Fact]
    public async Task NewUser_HasTheSeededCategoriesAndRules_OfTheirOwn()
    {
        // A User of its own, since the tests' other Users have the tests' Categories added.
        var fresh = await _factory.CreateSignedInClientAsync();
        var categories = await Categories(fresh);
        var rules = await Rules(fresh);

        Assert.Equal(
            ["Housing", "Groceries", "Clothing", "Transport", "Other", "Income", "Savings"],
            categories.Select(c => c.Name));
        Assert.All(categories, c => Assert.True(c.BuiltIn));
        Assert.All(categories, c => Assert.Equal(0, c.TransactionCount));
        Assert.Equal(14, rules.Count);
        Assert.All(rules, r => Assert.False(r.AiGenerated || r.IsNew));
        var categoryByName = categories.ToDictionary(c => c.Name, c => c.Id);
        var categoryByKeyword = rules.ToDictionary(r => r.Keyword, r => r.CategoryId);
        Assert.Equal(categoryByName["Groceries"], categoryByKeyword["rema"]);
        Assert.Equal(categoryByName["Clothing"], categoryByKeyword["cubus"]);
        Assert.Equal(categoryByName["Transport"], categoryByKeyword["ruter"]);
        Assert.Equal(categoryByName["Savings"], categoryByKeyword["overføring til konto"]);

        // Another User's seeds are copies, not the same rows.
        Assert.NotEqual(_categoriesA.Groceries, categoryByName["Groceries"]);
        Assert.Empty((await Rules(_a)).Select(r => r.Id).Intersect(rules.Select(r => r.Id)));
        Assert.Empty(await August(fresh));
    }

    [Fact]
    public async Task Users_SeeOnlyTheirOwnTransactionsCategoriesRulesAndSpending()
    {
        var hobbies = await AddCategory(_a, "Hobbies");
        var transactionId = await AddTransaction(_a, hobbies);
        var rule = await AddRule(_a, "kafé", hobbies);

        Assert.Equal([transactionId], (await August(_a)).Select(t => t.Id));
        Assert.Empty(await August(_b));
        Assert.Empty((await _b.GetFromJsonAsync<List<TransactionMonthResponse>>("/api/transactions/months"))!);
        Assert.DoesNotContain(await Categories(_b), c => c.Name == "Hobbies");
        Assert.DoesNotContain(await Rules(_b), r => r.Id == rule.Id || r.Keyword == "kafé");
        Assert.Empty((await _b.GetFromJsonAsync<List<PossibleDuplicateResponse>>(
            "/api/transactions/possible-duplicates?date=2026-08-03&amount=-100"))!);
        Assert.Equal(0m, (await _b.GetFromJsonAsync<SpendingResponse>("/api/spending?year=2026&month=8"))!.Total);
        Assert.All(
            (await _b.GetFromJsonAsync<List<MonthlySpendingResponse>>(
                "/api/spending/monthly?fromYear=2026&fromMonth=7&toYear=2026&toMonth=9"))!,
            month => Assert.Empty(month.Slices));
        Assert.Equal(100m, (await _a.GetFromJsonAsync<SpendingResponse>("/api/spending?year=2026&month=8"))!.Total);
        // The other User's Categories don't count what this User has.
        Assert.All(await Categories(_b), c => Assert.Equal(0, c.TransactionCount));
    }

    [Fact]
    public async Task AnotherUsersIds_GiveNotFound()
    {
        var transactionId = await AddTransaction(_a, _categoriesA.Other);
        var categoryId = await AddCategory(_a, "Hobbies");
        var ruleId = (await AddRule(_a, "kafé", _categoriesA.Restaurants)).Id;

        Assert.Equal(HttpStatusCode.NotFound,
            (await _b.PutAsJsonAsync($"/api/transactions/{transactionId}/note", new { note = "Mine now" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await _b.PutAsJsonAsync($"/api/transactions/{transactionId}/category", new { categoryId = _categoriesB.Other })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _b.DeleteAsync($"/api/transactions/{transactionId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await _b.PutAsJsonAsync($"/api/categories/{categoryId}", new { name = "Mine", description = "Mine." })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _b.DeleteAsync($"/api/categories/{categoryId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await _b.PutAsJsonAsync($"/api/categorization-rules/{ruleId}", new { keyword = "mine", categoryId = _categoriesB.Other })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _b.DeleteAsync($"/api/categorization-rules/{ruleId}")).StatusCode);

        // Nothing of the first User's changed.
        Assert.Equal((null, _categoriesA.Other), (await August(_a)).Select(t => (t.Note, t.CategoryId)).Single());
        Assert.Contains(await Categories(_a), c => c.Id == categoryId && c.Name == "Hobbies");
        Assert.Contains(await Rules(_a), r => r.Id == ruleId && r.Keyword == "kafé");
    }

    [Fact]
    public async Task AnotherUsersBookmarks_CantBeSeenAddedOrRemoved()
    {
        var bookmarkedId = await AddTransaction(_a, _categoriesA.Other, "Bookmarked");
        var notBookmarkedId = await AddTransaction(_a, _categoriesA.Other, "Not bookmarked");
        Assert.Equal(HttpStatusCode.OK, (await _a.PostAsync($"/api/transactions/{bookmarkedId}/bookmark", null)).StatusCode);

        Assert.Empty((await _b.GetFromJsonAsync<List<TransactionResponse>>("/api/bookmarks"))!);
        Assert.Equal(HttpStatusCode.NotFound, (await _b.PostAsync($"/api/transactions/{notBookmarkedId}/bookmark", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _b.DeleteAsync($"/api/transactions/{bookmarkedId}/bookmark")).StatusCode);

        // Nothing of the first User's changed.
        Assert.Equal(
            [("Bookmarked", true), ("Not bookmarked", false)],
            (await August(_a)).Select(t => (t.Description, t.Bookmarked)).Order());
        Assert.Equal(
            [bookmarkedId],
            (await _a.GetFromJsonAsync<List<TransactionResponse>>("/api/bookmarks"))!.Select(t => t.Id));
    }

    // Answered as if it didn't exist, so nobody can even tell whether another User's Transaction has a
    // Receipt.
    [Fact]
    public async Task AnotherUsersReceipt_GivesNotFound()
    {
        var transactionId = (await TransactionWithReceipt.CreateAsync(
            _a, new { date = "2026-08-03", description = "Kafé Sentrum", amount = -100m, categoryId = _categoriesA.Other })).Id;

        Assert.Equal(HttpStatusCode.NotFound, (await _b.GetAsync($"/api/transactions/{transactionId}/receipt")).StatusCode);

        // The first User's is still served.
        Assert.Equal(HttpStatusCode.OK, (await _a.GetAsync($"/api/transactions/{transactionId}/receipt")).StatusCode);
    }

    private static Task<HttpResponseMessage> PostFolder(HttpClient client, string name) =>
        client.PostAsJsonAsync("/api/folders", new { name });

    private static async Task<int> AddFolder(HttpClient client, string name)
    {
        var response = await PostFolder(client, name);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<FolderResponse>())!.Id;
    }

    private static Task<HttpResponseMessage> PutBookmark(HttpClient client, int transactionId, int? folderId) =>
        client.PutAsJsonAsync($"/api/transactions/{transactionId}/bookmark", new { folderId });

    private static async Task FileBookmark(HttpClient client, int transactionId, int? folderId) =>
        Assert.Equal(HttpStatusCode.OK, (await PutBookmark(client, transactionId, folderId)).StatusCode);

    // The Folder a new Bookmark of the User's went into, as adding answered.
    private static async Task<int?> FolderOfNewBookmark(HttpClient client, int categoryId)
    {
        var response = await client.PostAsync($"/api/transactions/{await AddTransaction(client, categoryId)}/bookmark", null);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<BookmarkResponse>())!.FolderId;
    }

    private static async Task<List<FolderResponse>> Folders(HttpClient client) =>
        (await client.GetFromJsonAsync<List<FolderResponse>>("/api/folders"))!;

    [Fact]
    public async Task AnotherUsersFolders_CantBeSeenNorTheirBookmarksListed()
    {
        var created = await PostFolder(_a, "Tax deductible");
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var folderId = (await created.Content.ReadFromJsonAsync<FolderResponse>())!.Id;
        var transactionId = await AddTransaction(_a, _categoriesA.Other);
        await FileBookmark(_a, transactionId, folderId);

        Assert.Empty(await Folders(_b));
        Assert.Equal(HttpStatusCode.NotFound, (await _b.GetAsync($"/api/bookmarks?folderId={folderId}")).StatusCode);

        // Nothing of the first User's changed.
        Assert.Equal([("Tax deductible", folderId)], (await Folders(_a)).Select(f => (f.Name, f.Id)));
        Assert.Equal(
            [transactionId],
            (await _a.GetFromJsonAsync<List<TransactionResponse>>($"/api/bookmarks?folderId={folderId}"))!.Select(t => t.Id));
    }

    [Fact]
    public async Task AnotherUsersFolders_CantBeRenamedOrDeleted()
    {
        var created = await PostFolder(_a, "Tax deductible");
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var folderId = (await created.Content.ReadFromJsonAsync<FolderResponse>())!.Id;
        var transactionId = await AddTransaction(_a, _categoriesA.Other);
        await FileBookmark(_a, transactionId, folderId);

        Assert.Equal(HttpStatusCode.NotFound,
            (await _b.PutAsJsonAsync($"/api/folders/{folderId}", new { name = "Mine now" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _b.DeleteAsync($"/api/folders/{folderId}")).StatusCode);

        // Nothing of the first User's changed.
        Assert.Equal([("Tax deductible", folderId)], (await Folders(_a)).Select(f => (f.Name, f.Id)));
        Assert.Equal(
            [transactionId],
            (await _a.GetFromJsonAsync<List<TransactionResponse>>($"/api/bookmarks?folderId={folderId}"))!.Select(t => t.Id));
    }

    [Fact]
    public async Task EachUsersLastUsedFolder_IsTheirOwn()
    {
        var folderA = await AddFolder(_a, "Tax deductible");
        var folderB = await AddFolder(_b, "Warranty");
        await FileBookmark(_a, await AddTransaction(_a, _categoriesA.Other), folderA);

        Assert.Null(await FolderOfNewBookmark(_b, _categoriesB.Other));

        await FileBookmark(_b, await AddTransaction(_b, _categoriesB.Other), folderB);

        Assert.Equal(folderA, await FolderOfNewBookmark(_a, _categoriesA.Other));
        Assert.Equal(folderB, await FolderOfNewBookmark(_b, _categoriesB.Other));
    }

    [Fact]
    public async Task AnotherUsersFolder_CantBeFiledIn_NorTheirBookmarksFiled()
    {
        var folderA = await AddFolder(_a, "Tax deductible");
        var transactionA = await AddTransaction(_a, _categoriesA.Other, "Bookmarked");
        await FileBookmark(_a, transactionA, folderId: null);
        var transactionB = await AddTransaction(_b, _categoriesB.Other);

        var intoTheirFolder = await PutBookmark(_b, transactionB, folderA);
        var theirBookmark = await PutBookmark(_b, transactionA, folderId: null);

        Assert.Equal(["The folder no longer exists."], (await ValidationErrors(intoTheirFolder))["folderId"]);
        Assert.Equal(HttpStatusCode.NotFound, theirBookmark.StatusCode);
        Assert.Empty((await _b.GetFromJsonAsync<List<TransactionResponse>>("/api/bookmarks"))!);
        Assert.Null(await FolderOfNewBookmark(_b, _categoriesB.Other));
        // Nothing of the first User's changed.
        Assert.Empty((await _a.GetFromJsonAsync<List<TransactionResponse>>($"/api/bookmarks?folderId={folderA}"))!);
        Assert.Equal(
            [transactionA],
            (await _a.GetFromJsonAsync<List<TransactionResponse>>("/api/bookmarks"))!.Select(t => t.Id));
    }

    [Fact]
    public async Task AnotherUsersFolder_CantBookmarkANewTransaction()
    {
        var folderA = await AddFolder(_a, "Tax deductible");

        var response = await _b.PostAsJsonAsync("/api/transactions", new
        {
            date = "2026-08-03",
            description = "Into their folder",
            amount = -100m,
            categoryId = _categoriesB.Other,
            bookmark = new { folderId = folderA },
        });

        Assert.Equal(["The folder no longer exists."], (await ValidationErrors(response))["bookmark"]);
        Assert.Empty(await August(_b));
        Assert.Null(await FolderOfNewBookmark(_b, _categoriesB.Other));
        // Nothing of the first User's changed.
        Assert.Empty((await _a.GetFromJsonAsync<List<TransactionResponse>>($"/api/bookmarks?folderId={folderA}"))!);
    }

    [Fact]
    public async Task FolderNames_MayRepeatAcrossUsers_ButNotWithinOne()
    {
        Assert.Equal(HttpStatusCode.Created, (await PostFolder(_a, "Tax deductible")).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await PostFolder(_b, "TAX DEDUCTIBLE")).StatusCode);

        var again = await PostFolder(_a, "tax deductible");

        Assert.Equal(["A folder named 'Tax deductible' already exists."], (await ValidationErrors(again))["name"]);
    }

    [Fact]
    public async Task AnotherUsersCategory_InARequest_IsAnUnknownCategory()
    {
        var ownTransactionId = await AddTransaction(_b, _categoriesB.Other);
        var ownCategoryId = await AddCategory(_b, "Hobbies");

        var transaction = await _b.PostAsJsonAsync("/api/transactions", new
        {
            date = "2026-08-03", description = "Kafé Sentrum", amount = -100m, categoryId = _categoriesA.Groceries,
        });
        var recategorized = await _b.PutAsJsonAsync(
            $"/api/transactions/{ownTransactionId}/category", new { categoryId = _categoriesA.Groceries });
        var rule = await PostRule(_b, "kafé", _categoriesA.Groceries);
        var replaced = await _b.DeleteAsync($"/api/categories/{ownCategoryId}?replacementCategoryId={_categoriesA.Groceries}");

        Assert.Equal(["Category does not exist."], (await ValidationErrors(transaction))["categoryId"]);
        Assert.Equal(["Category does not exist."], (await ValidationErrors(recategorized))["categoryId"]);
        Assert.Equal(["Category does not exist."], (await ValidationErrors(rule))["categoryId"]);
        Assert.Equal(["The replacement Category does not exist."], (await ValidationErrors(replaced))["replacementCategoryId"]);
        Assert.Equal(_categoriesB.Other, (await August(_b)).Single().CategoryId);
    }

    [Fact]
    public async Task BothUsers_CanImportTheSameBankStatement_ButNeitherTwice()
    {
        var pdf = Statement(AccountNumber());

        Assert.Equal(HttpStatusCode.Created, (await Upload(_a, pdf)).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await Upload(_b, pdf)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Upload(_a, pdf)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Upload(_b, pdf)).StatusCode);

        Assert.Single(await August(_a));
        Assert.Single(await August(_b));
    }

    [Fact]
    public async Task AnotherUsersBankStatements_CantBeListedOrDeleted()
    {
        var theirId = await Import(_a, Statement(AccountNumber()));
        var ownId = await Import(_b, Statement(AccountNumber()));

        var response = await _b.PostAsJsonAsync("/api/bank-statements/delete", new { ids = new[] { ownId, theirId } });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(
            [ownId],
            (await _b.GetFromJsonAsync<List<ListedBankStatementResponse>>("/api/bank-statements"))!.Select(s => s.Id));
        // Nothing of either User's was deleted.
        Assert.Equal(
            [theirId],
            (await _a.GetFromJsonAsync<List<ListedBankStatementResponse>>("/api/bank-statements"))!.Select(s => s.Id));
        Assert.Single(await August(_a));
        Assert.Single(await August(_b));
    }

    [Fact]
    public async Task DeletingAllTransactions_DeletesAndCountsOnlyThatUsersOwn()
    {
        var theirId = await Import(_a, Statement(AccountNumber()));
        await AddTransaction(_a, _categoriesA.Other);
        await Import(_b, Statement(AccountNumber()));

        Assert.Equal(1, (await _b.GetFromJsonAsync<DeleteCountsResponse>("/api/user/delete-counts"))!.TransactionCount);
        var response = await _b.DeleteAsync("/api/transactions");

        Assert.Equal(1, (await response.Content.ReadFromJsonAsync<DeletedTransactionsResponse>())!.TransactionsDeleted);
        Assert.Empty(await August(_b));
        Assert.Equal(2, (await August(_a)).Count);
        Assert.Equal(
            [theirId],
            (await _a.GetFromJsonAsync<List<ListedBankStatementResponse>>("/api/bank-statements"))!.Select(s => s.Id));
        Assert.Equal(2, (await _a.GetFromJsonAsync<DeleteCountsResponse>("/api/user/delete-counts"))!.TransactionCount);
    }

    [Fact]
    public async Task DeletingAllRules_DeletesAndCountsOnlyThatUsersOwn()
    {
        await AddRule(_a, "kafé", _categoriesA.Restaurants);
        await AddRule(_b, "kafé", _categoriesB.Restaurants);
        await Import(_a, Statement(AccountNumber()));
        await Import(_b, Statement(AccountNumber()));
        var theirRules = await Rules(_a);
        var theirCounts = await _a.GetFromJsonAsync<DeleteCountsResponse>("/api/user/delete-counts");

        Assert.Equal(1, (await _b.GetFromJsonAsync<DeleteCountsResponse>("/api/user/delete-counts"))!.RuleCategorizedTransactionCount);
        var response = await _b.DeleteAsync("/api/categorization-rules");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Empty(await Rules(_b));
        Assert.Null((await August(_b)).Single().CategoryId);
        Assert.Equal(theirRules, await Rules(_a));
        Assert.Equal(_categoriesA.Restaurants, (await August(_a)).Single().CategoryId);
        Assert.Equal(theirCounts, await _a.GetFromJsonAsync<DeleteCountsResponse>("/api/user/delete-counts"));
    }

    [Fact]
    public async Task CategoryNamesAndKeywords_MayRepeatAcrossUsers_ButNotWithinOne()
    {
        await AddCategory(_a, "Hobbies");
        await AddCategory(_b, "hobbies");
        await AddRule(_a, "kafé", _categoriesA.Restaurants);
        await AddRule(_b, "KAFÉ", _categoriesB.Restaurants);

        var category = await _a.PostAsJsonAsync("/api/categories", new { name = "HOBBIES", description = "Again." });
        var rule = await PostRule(_b, "Kafé", _categoriesB.Restaurants);

        Assert.Equal(["A category named 'Hobbies' already exists."], (await ValidationErrors(category))["name"]);
        Assert.Equal(["A rule for 'KAFÉ' already exists."], (await ValidationErrors(rule))["keyword"]);
    }

    [Fact]
    public async Task ARuleChange_RematchesOnlyThatUsersTransactions()
    {
        Assert.Equal(HttpStatusCode.Created, (await Upload(_a, Statement(AccountNumber()))).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await Upload(_b, Statement(AccountNumber()))).StatusCode);

        var rule = await AddRule(_a, "kafé", _categoriesA.Restaurants);

        Assert.Equal(1, rule.TransactionsChanged);
        Assert.Equal(_categoriesA.Restaurants, (await August(_a)).Single().CategoryId);
        Assert.Null((await August(_b)).Single().CategoryId);
    }

    [Fact]
    public async Task DeletingACategory_MovesOnlyThatUsersTransactionsAndRules()
    {
        var hobbiesA = await AddCategory(_a, "Hobbies");
        var hobbiesB = await AddCategory(_b, "Hobbies");
        await AddTransaction(_a, hobbiesA);
        await AddTransaction(_b, hobbiesB);
        await AddRule(_a, "kafé", hobbiesA);
        await AddRule(_b, "kafé", hobbiesB);

        var response = await _a.DeleteAsync($"/api/categories/{hobbiesA}?replacementCategoryId={_categoriesA.Other}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(1, (await response.Content.ReadFromJsonAsync<DeletedCategoryResponse>())!.TransactionsChanged);
        Assert.Equal(hobbiesB, (await August(_b)).Single().CategoryId);
        Assert.Equal(hobbiesB, (await Rules(_b)).Single(r => r.Keyword == "kafé").CategoryId);
    }

    [Fact]
    public async Task NewRuleMarks_FollowEachUsersOwnLatestUpload()
    {
        var generator = new FakeRuleGenerator().Proposing("Kafé Sentrum", "kafé", "Restaurants");
        await using var api = _factory.WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services => services.AddSingleton<IRuleGenerator>(generator)));
        var a = await api.CreateClientSignedInAsAsync(_emailA);
        var b = await api.CreateSignedInClientAsync();

        Assert.Equal(HttpStatusCode.Created, (await Upload(a, Statement(AccountNumber()))).StatusCode);
        // An Upload of the other User's, adding no rule, which would clear the marks if it were the
        // first User's.
        Assert.Equal(HttpStatusCode.Created, (await Upload(b, Statement(AccountNumber(), "Varer 03.08 Rema 1000"))).StatusCode);

        var rule = (await Rules(a)).Single(r => r.Keyword == "kafé");
        Assert.True(rule.IsNew);
        Assert.True(rule.AiGenerated);
        Assert.Equal(_categoriesA.Restaurants, rule.CategoryId);
        Assert.DoesNotContain(await Rules(b), r => r.Keyword == "kafé" || r.IsNew);
    }

    [Fact]
    public async Task TheLlm_IsOfferedOnlyTheUsersOwnCategories_AndAReceiptMatchesOnlyTheirRules()
    {
        await AddCategory(_a, "Hobbies");
        await AddRule(_a, "kafé", _categoriesA.Restaurants);
        var generator = new FakeRuleGenerator();
        var reader = new FakeReceiptReader
        {
            Reading = new ReceiptReading.Read(new DateOnly(2026, 8, 3), "Kafé Sentrum", 100m, "NOK", false, "Other"),
        };
        await using var api = _factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
            services.AddSingleton<IRuleGenerator>(generator).AddSingleton<IReceiptReader>(reader)));
        var b = await api.CreateSignedInClientAsync();

        Assert.Equal(HttpStatusCode.Created, (await Upload(b, Statement(AccountNumber()))).StatusCode);
        var image = new ByteArrayContent([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, .."JFIF"u8, 0x00]);
        image.Headers.ContentType = new MediaTypeHeaderValue("image/jpeg");
        using var form = new MultipartFormDataContent { { image, "file", "kvittering.jpg" } };
        var suggestion = await (await b.PostAsync("/api/receipts/read", form)).Content.ReadFromJsonAsync<ReceiptSuggestion>();

        Assert.DoesNotContain(generator.Calls.Single().Categories, c => c.Name == "Hobbies");
        Assert.DoesNotContain(reader.Calls.Single().Categories, c => c.Name == "Hobbies");
        Assert.Equal(Seeds.Categories.Count, reader.Calls.Single().Categories.Count);
        // Not the first User's rule for "kafé": the reader's own choice, among this User's Categories.
        Assert.Equal((await TestCategories.Of(b)).Other, suggestion!.CategoryId);
    }

    [Fact]
    public async Task StartUp_RematchesEachUsersImportedTransactions_AgainstTheirOwnRulesOnly()
    {
        // Only the second User has a rule for the café.
        await AddRule(_b, "kafé", _categoriesB.Restaurants);
        // Stored as if imported before the rules changed, all Uncategorized.
        await StoreImported(_emailA, "Kafé Sentrum", "Rema 1000");
        await StoreImported(_emailB, "Rema 1000");

        // Starting another API runs the start-up again.
        await using var api = _factory.WithWebHostBuilder(_ => { });
        _ = api.Services;

        var august = (await August(_a)).ToDictionary(t => t.Description, t => t.CategoryId);
        Assert.Null(august["Kafé Sentrum"]);
        Assert.Equal(_categoriesA.Groceries, august["Rema 1000"]);
        Assert.Equal(_categoriesB.Groceries, (await August(_b)).Single().CategoryId);
    }

    // Stores the User's Uncategorized Transactions straight in the database, as if imported in
    // August 2026.
    private async Task StoreImported(string email, params string[] descriptions)
    {
        await using var user = await UserDatabase.OfAsync(_factory, email);
        var owner = user.Db.OwnerOfNewRows;
        var statement = new BankStatement
        {
            UserId = owner,
            AccountNumber = AccountNumber(),
            PeriodStart = new DateOnly(2026, 8, 1),
            PeriodEnd = new DateOnly(2026, 8, 31),
            ImportedAt = DateTimeOffset.UtcNow,
        };
        statement.Transactions.AddRange(descriptions
            .Select(d => new Transaction { UserId = owner, PostedDate = new DateOnly(2026, 8, 3), Description = d, Amount = -100m }));
        user.Db.BankStatements.Add(statement);
        await user.Db.SaveChangesAsync();
    }
}
