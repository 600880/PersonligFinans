using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using PersonligFinans.Api.Bookmarks;
using PersonligFinans.Api.Spending;
using PersonligFinans.Api.Transactions;

namespace PersonligFinans.Api.Tests;

[Collection(ApiCollection.Name)]
public class BookmarkEndpointsTests : IAsyncLifetime
{
    private readonly PostgresApiFactory _factory;
    private HttpClient _client = null!;
    private TestCategories _categories = null!;

    public BookmarkEndpointsTests(PostgresApiFactory factory)
    {
        _factory = factory;
    }

    public async Task InitializeAsync()
    {
        _client = await _factory.CreateSignedInClientAsync();
        _categories = await TestCategories.Of(_client);
    }

    public Task DisposeAsync() => Task.CompletedTask;

    // Adds a manually-entered Transaction in Other and returns it as the API answered.
    private async Task<TransactionResponse> AddTransaction(string date = "2026-09-24", string description = "Rema 1000")
    {
        var response = await _client.PostAsJsonAsync("/api/transactions", new
        {
            date,
            description,
            amount = -249.90m,
            categoryId = _categories.Other,
        });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<TransactionResponse>())!;
    }

    private Task<HttpResponseMessage> AddBookmark(int transactionId) =>
        _client.PostAsync($"/api/transactions/{transactionId}/bookmark", content: null);

    private Task<HttpResponseMessage> RemoveBookmark(int transactionId) =>
        _client.DeleteAsync($"/api/transactions/{transactionId}/bookmark");

    private async Task Bookmark(int transactionId) =>
        Assert.Equal(HttpStatusCode.OK, (await AddBookmark(transactionId)).StatusCode);

    private async Task<List<TransactionResponse>> Bookmarks() =>
        (await _client.GetFromJsonAsync<List<TransactionResponse>>("/api/bookmarks"))!;

    private async Task<List<TransactionResponse>> TransactionsOf(int year, int month) =>
        (await _client.GetFromJsonAsync<List<TransactionResponse>>($"/api/transactions?year={year}&month={month}"))!;

    [Fact]
    public async Task Post_Bookmark_AnswersNoFolderAndListsTheTransactionAsBookmarked()
    {
        var transaction = await AddTransaction();

        var response = await AddBookmark(transaction.Id);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(new BookmarkResponse(FolderId: null), await response.Content.ReadFromJsonAsync<BookmarkResponse>());
        Assert.Equal([transaction with { Bookmarked = true }], await Bookmarks());
    }

    [Fact]
    public async Task Post_Bookmark_OfABookmarkedTransaction_LeavesItAsItWas()
    {
        var transaction = await AddTransaction();
        await Bookmark(transaction.Id);

        var response = await AddBookmark(transaction.Id);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(new BookmarkResponse(FolderId: null), await response.Content.ReadFromJsonAsync<BookmarkResponse>());
        Assert.Equal([transaction.Id], (await Bookmarks()).Select(t => t.Id));
    }

    [Fact]
    public async Task Delete_Bookmark_RemovesIt_AndAnswersTheSameWhenRepeated()
    {
        var transaction = await AddTransaction(date: "2026-09-24");
        await Bookmark(transaction.Id);

        var first = await RemoveBookmark(transaction.Id);
        var second = await RemoveBookmark(transaction.Id);

        Assert.Equal(HttpStatusCode.NoContent, first.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, second.StatusCode);
        Assert.Empty(await Bookmarks());
        Assert.False((await TransactionsOf(2026, 9)).Single().Bookmarked);
    }

    [Fact]
    public async Task Delete_Bookmark_OfATransactionNeverBookmarked_AnswersNoContent()
    {
        var transaction = await AddTransaction();

        var response = await RemoveBookmark(transaction.Id);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    }

    [Fact]
    public async Task UnknownTransaction_ReturnsNotFound()
    {
        Assert.Equal(HttpStatusCode.NotFound, (await AddBookmark(int.MaxValue)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await RemoveBookmark(int.MaxValue)).StatusCode);
    }

    [Fact]
    public async Task Get_Bookmarks_ListsOnlyBookmarkedTransactionsFromAnyDate_NewestFirstWithTheIdAsTieBreak()
    {
        var older = await AddTransaction(date: "2019-03-01", description: "older");
        var sameDayFirst = await AddTransaction(date: "2031-06-15", description: "same day, added first");
        await AddTransaction(date: "2031-06-20", description: "not bookmarked");
        var sameDaySecond = await AddTransaction(date: "2031-06-15", description: "same day, added second");
        var newest = await AddTransaction(date: "2040-01-01", description: "newest");
        // Bookmarked in another order than they are listed.
        foreach (var transaction in new[] { sameDayFirst, newest, older, sameDaySecond })
            await Bookmark(transaction.Id);

        var bookmarks = await Bookmarks();

        Assert.Equal(
            ["newest", "same day, added second", "same day, added first", "older"],
            bookmarks.Select(t => t.Description));
    }

    [Fact]
    public async Task Get_Bookmarks_ListsEachTransactionAsThePeriodsListDoes()
    {
        var transaction = await AddTransaction(date: "2026-09-24", description: "Rema 1000");
        await _client.PutAsJsonAsync($"/api/transactions/{transaction.Id}/note", new { note = "Warranty" });
        await Bookmark(transaction.Id);

        var listed = (await TransactionsOf(2026, 9)).Single();

        Assert.Equal(transaction with { Note = "Warranty", Bookmarked = true }, listed);
        Assert.Equal([listed], await Bookmarks());
    }

    [Fact]
    public async Task TransactionResponses_SayWhetherTheTransactionIsBookmarked()
    {
        var created = await AddTransaction(date: "2026-09-24");
        await Bookmark(created.Id);

        var noteChanged = await _client.PutAsJsonAsync($"/api/transactions/{created.Id}/note", new { note = "Warranty" });
        var categoryChanged = await _client.PutAsJsonAsync(
            $"/api/transactions/{created.Id}/category", new { categoryId = _categories.Groceries });

        Assert.False(created.Bookmarked);
        Assert.True((await noteChanged.Content.ReadFromJsonAsync<TransactionResponse>())!.Bookmarked);
        Assert.True((await categoryChanged.Content.ReadFromJsonAsync<TransactionResponse>())!.Bookmarked);
        Assert.True((await TransactionsOf(2026, 9)).Single().Bookmarked);
    }

    [Fact]
    public async Task DeletingABookmarkedManuallyEnteredTransaction_DeletesItsBookmark()
    {
        var transaction = await AddTransaction();
        await Bookmark(transaction.Id);

        var response = await _client.DeleteAsync($"/api/transactions/{transaction.Id}");

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Empty(await Bookmarks());
    }

    [Fact]
    public async Task BookmarkingAndRemoving_LeaveTheCategoryLockedStateNoteAndSpendingUnchanged()
    {
        // An imported Transaction that a rule categorized, so it isn't Locked, with a Note.
        var rule = await _client.PostAsJsonAsync(
            "/api/categorization-rules", new { keyword = "kafé", categoryId = _categories.Restaurants });
        Assert.Equal(HttpStatusCode.Created, rule.StatusCode);
        await Upload(StatementPdf.WithPurchasesFrom("Kafé Sentrum"));
        var imported = (await TransactionsOf(2026, 8)).Single();
        await _client.PutAsJsonAsync($"/api/transactions/{imported.Id}/note", new { note = "Split with Ola" });
        var before = (await TransactionsOf(2026, 8)).Single();
        var spendingBefore = await SpendingOfAugust();

        await Bookmark(imported.Id);
        var bookmarked = (await TransactionsOf(2026, 8)).Single();
        var spendingBookmarked = await SpendingOfAugust();
        Assert.Equal(HttpStatusCode.NoContent, (await RemoveBookmark(imported.Id)).StatusCode);

        Assert.Equal((_categories.Restaurants, false, "Split with Ola"), (before.CategoryId, before.Locked, before.Note));
        Assert.Equal(before with { Bookmarked = true }, bookmarked);
        Assert.Equal(before, (await TransactionsOf(2026, 8)).Single());
        Assert.Equal(10m, spendingBefore.Total);
        Assert.Equal(spendingBefore.Total, spendingBookmarked.Total);
        Assert.Equal(spendingBefore.Slices, spendingBookmarked.Slices);
        var spendingAfter = await SpendingOfAugust();
        Assert.Equal(spendingBefore.Total, spendingAfter.Total);
        Assert.Equal(spendingBefore.Slices, spendingAfter.Slices);
    }

    private async Task Upload(byte[] pdf)
    {
        var file = new ByteArrayContent(pdf);
        file.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
        using var form = new MultipartFormDataContent { { file, "file", "kontoutskrift.pdf" } };
        Assert.Equal(HttpStatusCode.Created, (await _client.PostAsync("/api/bank-statements", form)).StatusCode);
    }

    private async Task<SpendingResponse> SpendingOfAugust() =>
        (await _client.GetFromJsonAsync<SpendingResponse>("/api/spending?year=2026&month=8"))!;
}
