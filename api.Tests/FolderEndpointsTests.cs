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

    // Deleted straight in the database, since the API can't delete Folders yet.
    [Fact]
    public async Task DeletingAFolder_DeletesItsBookmarks_ButNotTheirTransactions()
    {
        var folder = await AddedFolder("Tax deductible");
        var categories = await TestCategories.Of(_client);
        var created = await _client.PostAsJsonAsync("/api/transactions", new
        {
            date = "2026-09-24", description = "Rema 1000", amount = -249.90m, categoryId = categories.Other,
        });
        var transaction = (await created.Content.ReadFromJsonAsync<TransactionResponse>())!;
        Assert.Equal(HttpStatusCode.OK, (await _client.PostAsync($"/api/transactions/{transaction.Id}/bookmark", null)).StatusCode);
        await _factory.FileBookmarkAsync(_email, transaction.Id, folder.Id);
        await using (var user = await UserDatabase.OfAsync(_factory, _email))
            await user.Db.Folders.Where(f => f.Id == folder.Id).ExecuteDeleteAsync();

        var september = await _client.GetFromJsonAsync<List<TransactionResponse>>("/api/transactions?year=2026&month=9");

        Assert.Equal([transaction], september);
        Assert.False(september!.Single().Bookmarked);
        Assert.Empty(await ListFolders());
    }
}
