using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PersonligFinans.Api.Data;
using PersonligFinans.Api.Folders;
using PersonligFinans.Api.Transactions;

namespace PersonligFinans.Api.Tests;

[Collection(ApiCollection.Name)]
public class FolderEndpointsTests : IAsyncLifetime
{
    private readonly PostgresApiFactory _factory;
    private readonly string _email = SignedInClient.UniqueEmail();
    private HttpClient _client = null!;

    public FolderEndpointsTests(PostgresApiFactory factory)
    {
        _factory = factory;
    }

    // A User of its own for each test, so its Folders are only the ones the test creates.
    public async Task InitializeAsync()
    {
        _client = await _factory.CreateSignedInClientAsync(_email);
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private Task<HttpResponseMessage> AddFolder(string? name) =>
        _client.PostAsJsonAsync("/api/folders", new { name });

    private async Task<FolderResponse> AddedFolder(string name)
    {
        var response = await AddFolder(name);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<FolderResponse>())!;
    }

    private async Task<List<FolderResponse>> ListFolders() =>
        (await _client.GetFromJsonAsync<List<FolderResponse>>("/api/folders"))!;

    [Fact]
    public async Task Post_TrimsTheName_AndAnswersCreatedWithTheFolder()
    {
        var response = await AddFolder("  Tax deductible  ");

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var added = (await response.Content.ReadFromJsonAsync<FolderResponse>())!;
        Assert.Equal("Tax deductible", added.Name);
        Assert.Equal($"/api/folders/{added.Id}", response.Headers.Location?.ToString());
        Assert.Equal([added], await ListFolders());
    }

    [Fact]
    public async Task Get_ListsTheFoldersByNameInTheNorwegianAlphabetIgnoringCase()
    {
        // Created out of order: in the Norwegian alphabet, ignoring case, Æ, Ø and Å come last.
        foreach (var name in new[] { "Åa", "Zzz", "øa", "warranty", "zzy", "Æa", "Tax" })
            await AddedFolder(name);

        var folders = await ListFolders();

        Assert.Equal(["Tax", "warranty", "zzy", "Zzz", "Æa", "øa", "Åa"], folders.Select(f => f.Name));
    }

    // The validation errors of a create the API refused, keyed on the request's fields.
    private async Task<Dictionary<string, string[]>> AddFolderExpectingValidationErrors(string? name)
    {
        var response = await AddFolder(name);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        return new((await response.Content.ReadFromJsonAsync<ValidationProblemDetails>())!.Errors);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Post_BlankName_IsAValidationProblem(string? name)
    {
        var errors = await AddFolderExpectingValidationErrors(name);

        Assert.Equal(["Name is required."], errors["name"]);
        Assert.Empty(await ListFolders());
    }

    [Fact]
    public async Task Post_NameOver50Characters_IsAValidationProblem()
    {
        var errors = await AddFolderExpectingValidationErrors(new string('n', 51));

        Assert.Equal(["Name must be at most 50 characters."], errors["name"]);
    }

    [Fact]
    public async Task Post_NameOf50Characters_IsAccepted()
    {
        var added = await AddedFolder(new string('n', 50));

        Assert.Equal(50, added.Name.Length);
    }

    [Fact]
    public async Task Post_NameOfAnotherFolderIgnoringCase_IsAValidationProblem()
    {
        await AddedFolder("Tax deductible");

        var errors = await AddFolderExpectingValidationErrors(" TAX DEDUCTIBLE ");

        Assert.Equal(["A folder named 'Tax deductible' already exists."], errors["name"]);
        Assert.Equal(["Tax deductible"], (await ListFolders()).Select(f => f.Name));
    }

    // "Bookmarks" is how the app lists the Bookmarks in no Folder, so no Folder may have it.
    [Theory]
    [InlineData("Bookmarks")]
    [InlineData("bookmarks")]
    [InlineData(" BOOKMARKS ")]
    public async Task Post_Bookmarks_InAnyCase_IsAValidationProblem(string name)
    {
        var errors = await AddFolderExpectingValidationErrors(name);

        Assert.Equal(["A folder can't be named 'Bookmarks'."], errors["name"]);
        Assert.Empty(await ListFolders());
    }

    private Task<HttpResponseMessage> RenameFolder(int id, string? name) =>
        _client.PutAsJsonAsync($"/api/folders/{id}", new { name });

    [Fact]
    public async Task Put_RenamesTheFolder_TrimmingTheName_AndAnswersWithTheFolder()
    {
        var folder = await AddedFolder("Warranty");
        await AddedFolder("Tax deductible");

        var response = await RenameFolder(folder.Id, "  Abonnement  ");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(new FolderResponse(folder.Id, "Abonnement"), await response.Content.ReadFromJsonAsync<FolderResponse>());
        Assert.Equal(["Abonnement", "Tax deductible"], (await ListFolders()).Select(f => f.Name));
    }

    // A Folder's own name isn't taken, so it can change only its letter case.
    [Fact]
    public async Task Put_ChangingOnlyTheLetterCase_IsAccepted()
    {
        var folder = await AddedFolder("tax deductible");

        var response = await RenameFolder(folder.Id, "Tax deductible");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(["Tax deductible"], (await ListFolders()).Select(f => f.Name));
    }

    // The validation errors of a rename the API refused, keyed on the request's fields.
    private async Task<Dictionary<string, string[]>> RenameFolderExpectingValidationErrors(int id, string? name)
    {
        var response = await RenameFolder(id, name);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        return new((await response.Content.ReadFromJsonAsync<ValidationProblemDetails>())!.Errors);
    }

    [Theory]
    [InlineData(null, "Name is required.")]
    [InlineData("   ", "Name is required.")]
    [InlineData("nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn", "Name must be at most 50 characters.")]
    [InlineData(" TAX DEDUCTIBLE ", "A folder named 'Tax deductible' already exists.")]
    [InlineData(" bookmarks ", "A folder can't be named 'Bookmarks'.")]
    public async Task Put_ANameACreateWouldRefuse_IsAValidationProblem_AndKeepsTheName(string? name, string error)
    {
        var folder = await AddedFolder("Warranty");
        await AddedFolder("Tax deductible");

        var errors = await RenameFolderExpectingValidationErrors(folder.Id, name);

        Assert.Equal([error], errors["name"]);
        Assert.Equal(["Tax deductible", "Warranty"], (await ListFolders()).Select(f => f.Name));
    }

    [Fact]
    public async Task Put_UnknownId_IsNotFound()
    {
        var folder = await AddedFolder("Warranty");

        var response = await RenameFolder(folder.Id + 1000, "Abonnement");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal(["Warranty"], (await ListFolders()).Select(f => f.Name));
    }

    [Fact]
    public async Task FolderNames_AreUniqueIgnoringCase_InTheDatabase()
    {
        await using var user = await UserDatabase.OfAsync(_factory, _email);
        var db = user.Db;
        db.Folders.Add(new Folder { UserId = db.OwnerOfNewRows, Name = "Tax" });
        await db.SaveChangesAsync();

        db.Folders.Add(new Folder { UserId = db.OwnerOfNewRows, Name = "TAX" });

        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    // A Transaction dated in September 2026, bookmarked and filed in the Folder, or in none for null.
    private async Task<int> AddBookmarkedTransaction(string description, int? folderId)
    {
        var categories = await TestCategories.Of(_client);
        var created = await _client.PostAsJsonAsync("/api/transactions", new
        {
            date = "2026-09-24", description, amount = -249.90m, categoryId = categories.Other,
        });
        var transaction = (await created.Content.ReadFromJsonAsync<TransactionResponse>())!;
        var filed = await _client.PutAsJsonAsync($"/api/transactions/{transaction.Id}/bookmark", new { folderId });
        Assert.Equal(HttpStatusCode.OK, filed.StatusCode);
        return transaction.Id;
    }

    private async Task<List<int>> ListedBookmarkIds(string url) =>
        (await _client.GetFromJsonAsync<List<TransactionResponse>>(url))!.Select(t => t.Id).ToList();

    [Fact]
    public async Task Delete_DeletesTheFolderAndItsBookmarks_ButNotTheirTransactions()
    {
        var taxDeductible = await AddedFolder("Tax deductible");
        var warranty = await AddedFolder("Warranty");
        await AddBookmarkedTransaction("Rema 1000", taxDeductible.Id);
        var inWarranty = await AddBookmarkedTransaction("Elkjøp", warranty.Id);
        var inNoFolder = await AddBookmarkedTransaction("Kiwi", folderId: null);

        var response = await _client.DeleteAsync($"/api/folders/{taxDeductible.Id}");

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal([warranty], await ListFolders());
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync($"/api/bookmarks?folderId={taxDeductible.Id}")).StatusCode);
        // Its Transaction remains, no longer bookmarked, and the other Bookmarks stay where they were.
        Assert.Equal(
            [("Elkjøp", true), ("Kiwi", true), ("Rema 1000", false)],
            (await _client.GetFromJsonAsync<List<TransactionResponse>>("/api/transactions?year=2026&month=9"))!
                .Select(t => (t.Description, t.Bookmarked))
                .Order());
        Assert.Equal([inWarranty], await ListedBookmarkIds($"/api/bookmarks?folderId={warranty.Id}"));
        Assert.Equal([inNoFolder], await ListedBookmarkIds("/api/bookmarks"));
    }

    [Fact]
    public async Task Delete_UnknownId_IsNotFound()
    {
        var folder = await AddedFolder("Warranty");

        var response = await _client.DeleteAsync($"/api/folders/{folder.Id + 1000}");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal([folder], await ListFolders());
    }
}
