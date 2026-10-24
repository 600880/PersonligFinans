using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using PersonligFinans.Api.Folders;
using PersonligFinans.Api.Transactions;

namespace PersonligFinans.Api.Tests;

// Keeping a Receipt: a Transaction saved from a Receipt scan is created together with its Receipt,
// which is then served for as long as the Transaction exists.
[Collection(ApiCollection.Name)]
public class KeepReceiptTests : IAsyncLifetime
{
    private readonly PostgresApiFactory _factory;
    private HttpClient _client = null!;
    private TestCategories _categories = null!;

    public KeepReceiptTests(PostgresApiFactory factory)
    {
        _factory = factory;
    }

    public async Task InitializeAsync()
    {
        _client = await _factory.CreateSignedInClientAsync();
        _categories = await TestCategories.Of(_client);
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private static readonly byte[] Jpeg = TransactionWithReceipt.Jpeg;

    // A valid manually-entered Transaction in Other, as the JSON create takes it.
    private object Transaction(string description = "Rema 1000", object? bookmark = null) => new
    {
        date = "2026-09-24",
        description,
        amount = -249.90m,
        categoryId = _categories.Other,
        bookmark,
    };

    private Task<HttpResponseMessage> PostWithReceipt(MultipartFormDataContent form) =>
        _client.PostAsync(TransactionWithReceipt.Url, form);

    private Task<TransactionResponse> CreatedWithReceipt(object transaction) =>
        TransactionWithReceipt.CreateAsync(_client, transaction);

    private Task<HttpResponseMessage> GetReceipt(int transactionId) =>
        _client.GetAsync($"/api/transactions/{transactionId}/receipt");

    [Fact]
    public async Task Post_WithAReceipt_CreatesTheTransactionWithHasReceipt_AndServesExactlyTheBytesSent()
    {
        var created = await CreatedWithReceipt(Transaction("  Rema 1000  "));

        Assert.True(created.HasReceipt);
        Assert.Equal("Rema 1000", created.Description);
        var served = await GetReceipt(created.Id);
        Assert.Equal(HttpStatusCode.OK, served.StatusCode);
        Assert.Equal("image/jpeg", served.Content.Headers.ContentType?.MediaType);
        Assert.True(served.Headers.CacheControl?.NoStore);
        Assert.Equal(Jpeg, await served.Content.ReadAsByteArrayAsync());
    }

    [Fact]
    public async Task Post_JsonCreate_HasNoReceipt_AndServesNone()
    {
        var response = await _client.PostAsJsonAsync("/api/transactions", Transaction());
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = (await response.Content.ReadFromJsonAsync<TransactionResponse>())!;

        Assert.False(created.HasReceipt);
        Assert.Equal(HttpStatusCode.NotFound, (await GetReceipt(created.Id)).StatusCode);
    }

    private async Task<List<TransactionResponse>> September() =>
        (await _client.GetFromJsonAsync<List<TransactionResponse>>("/api/transactions?year=2026&month=9"))!;

    private static async Task<Dictionary<string, string[]>> ValidationErrors(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        return new((await response.Content.ReadFromJsonAsync<ValidationProblemDetails>())!.Errors);
    }

    // A Receipt that can't be kept, by what is wrong with it, each sent declared as a JPEG. A missing
    // one sends no receipt field at all.
    private static byte[]? ReceiptThatIs(string wrong) => wrong switch
    {
        "missing" => null,
        "empty" => [],
        "over 10 MB" => [.. Jpeg, .. new byte[10 * 1024 * 1024 + 1 - Jpeg.Length]],
        "a PNG" => [0x89, .."PNG"u8, 0x0D, 0x0A, 0x1A, 0x0A, 0x00],
        "not an image" => "not really a photo"u8.ToArray(),
        _ => throw new ArgumentOutOfRangeException(nameof(wrong)),
    };

    [Theory]
    [InlineData("missing", "Choose a Receipt to keep.")]
    [InlineData("empty", "Choose a Receipt to keep.")]
    [InlineData("over 10 MB", "The Receipt is larger than 10 MB.")]
    [InlineData("a PNG", "The Receipt is not a JPEG image.")]
    [InlineData("not an image", "The Receipt is not a JPEG image.")]
    public async Task Post_WithAReceiptThatCantBeKept_IsRefusedOnTheReceipt_AndCreatesNothing(string wrong, string message)
    {
        var response = await PostWithReceipt(
            TransactionWithReceipt.Form(JsonSerializer.Serialize(Transaction()), ReceiptThatIs(wrong)));

        var errors = await ValidationErrors(response);
        Assert.Equal(["receipt"], errors.Keys);
        Assert.Equal([message], errors["receipt"]);
        Assert.Empty(await September());
    }

    [Fact]
    public async Task Post_AJpegDeclaredAsAnotherType_IsKeptByItsBytes()
    {
        var response = await PostWithReceipt(
            TransactionWithReceipt.Form(JsonSerializer.Serialize(Transaction()), Jpeg, "application/octet-stream"));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    [Fact]
    public async Task Post_InvalidFieldsWithAValidReceipt_AreRefusedOnThoseFields_AndCreateNothing()
    {
        var response = await TransactionWithReceipt.PostAsync(
            _client,
            new { date = (string?)null, description = " ", amount = 0m, categoryId = int.MaxValue, bookmark = new { folderId = int.MaxValue } });

        var errors = await ValidationErrors(response);
        Assert.Equal(["amount", "bookmark", "categoryId", "date", "description"], errors.Keys.Order());
        Assert.Equal(["The folder no longer exists."], errors["bookmark"]);
        Assert.Empty(await September());
    }

    [Fact]
    public async Task Post_InvalidFieldsAndAReceiptThatCantBeKept_AreRefusedTogether()
    {
        var transaction = new { date = "2026-09-24", description = "", amount = -249.90m, categoryId = _categories.Other };

        var response = await PostWithReceipt(TransactionWithReceipt.Form(JsonSerializer.Serialize(transaction), receipt: null));

        Assert.Equal(["description", "receipt"], (await ValidationErrors(response)).Keys.Order());
        Assert.Empty(await September());
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not JSON")]
    [InlineData("null")]
    public async Task Post_WithoutTheTransactionsJson_IsRefusedOnTheTransaction_AndCreatesNothing(string? transaction)
    {
        var response = await PostWithReceipt(TransactionWithReceipt.Form(transaction, Jpeg));

        Assert.Equal(["transaction"], (await ValidationErrors(response)).Keys);
        Assert.Empty(await September());
    }

    [Fact]
    public async Task Post_WithoutAForm_IsRefused()
    {
        var response = await _client.PostAsJsonAsync(TransactionWithReceipt.Url, Transaction());

        Assert.Equal(["receipt", "transaction"], (await ValidationErrors(response)).Keys.Order());
        Assert.Empty(await September());
    }

    private async Task<int> AddFolder(string name)
    {
        var response = await _client.PostAsJsonAsync("/api/folders", new { name });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<FolderResponse>())!.Id;
    }

    [Fact]
    public async Task Post_WithAReceiptAndABookmark_BookmarksItToo()
    {
        var tax = await AddFolder("Tax deductible");

        var created = await CreatedWithReceipt(Transaction(bookmark: new { folderId = tax }));

        Assert.True(created.Bookmarked);
        Assert.True(created.HasReceipt);
        Assert.Equal(
            [created],
            (await _client.GetFromJsonAsync<List<TransactionResponse>>($"/api/bookmarks?folderId={tax}"))!);
    }

    [Fact]
    public async Task EveryListOfTransactions_SaysWhichHaveAReceipt()
    {
        var tax = await AddFolder("Tax deductible");
        var inBookmarks = await CreatedWithReceipt(Transaction("in Bookmarks", bookmark: new { folderId = (int?)null }));
        var inTheFolder = await CreatedWithReceipt(Transaction("in the folder", bookmark: new { folderId = tax }));
        var withoutAReceipt = await _client.PostAsJsonAsync("/api/transactions", Transaction("without a Receipt"));
        Assert.Equal(HttpStatusCode.Created, withoutAReceipt.StatusCode);

        Assert.Equal(
            [("in Bookmarks", true), ("in the folder", true), ("without a Receipt", false)],
            (await September()).Select(t => (t.Description, t.HasReceipt)).Order());
        Assert.Equal([inBookmarks], (await _client.GetFromJsonAsync<List<TransactionResponse>>("/api/bookmarks"))!);
        Assert.Equal(
            [inTheFolder],
            (await _client.GetFromJsonAsync<List<TransactionResponse>>($"/api/bookmarks?folderId={tax}"))!);
    }

    [Fact]
    public async Task ChangingTheNoteOrCategory_AnswersThatItHasAReceipt()
    {
        var created = await CreatedWithReceipt(Transaction());

        var noteChanged = await _client.PutAsJsonAsync($"/api/transactions/{created.Id}/note", new { note = "Warranty" });
        var categoryChanged = await _client.PutAsJsonAsync(
            $"/api/transactions/{created.Id}/category", new { categoryId = _categories.Groceries });

        Assert.True((await noteChanged.Content.ReadFromJsonAsync<TransactionResponse>())!.HasReceipt);
        Assert.True((await categoryChanged.Content.ReadFromJsonAsync<TransactionResponse>())!.HasReceipt);
    }

    [Fact]
    public async Task DeletingTheTransaction_DeletesItsReceipt()
    {
        var created = await CreatedWithReceipt(Transaction());

        Assert.Equal(HttpStatusCode.NoContent, (await _client.DeleteAsync($"/api/transactions/{created.Id}")).StatusCode);

        Assert.Equal(HttpStatusCode.NotFound, (await GetReceipt(created.Id)).StatusCode);
    }

    [Fact]
    public async Task DeletingAllTransactions_DeletesEveryReceipt()
    {
        var first = await CreatedWithReceipt(Transaction("first"));
        var second = await CreatedWithReceipt(Transaction("second"));

        Assert.Equal(HttpStatusCode.OK, (await _client.DeleteAsync("/api/transactions")).StatusCode);

        Assert.Equal(HttpStatusCode.NotFound, (await GetReceipt(first.Id)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await GetReceipt(second.Id)).StatusCode);
    }

    [Fact]
    public async Task Get_ReceiptOfAnUnknownTransaction_ReturnsNotFound()
    {
        Assert.Equal(HttpStatusCode.NotFound, (await GetReceipt(int.MaxValue)).StatusCode);
    }
}
