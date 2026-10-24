using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc;
using PersonligFinans.Api.BankStatements;
using PersonligFinans.Api.Categories;
using PersonligFinans.Api.CategorizationRules;
using PersonligFinans.Api.Data;
using PersonligFinans.Api.Folders;
using PersonligFinans.Api.Transactions;
using PersonligFinans.Api.Users;

namespace PersonligFinans.Api.Tests;

// Delete your User: removing the signed-in User and everything it owns, for good, by giving its
// password.
[Collection(ApiCollection.Name)]
public class DeleteYourUserTests
{
    private readonly PostgresApiFactory _factory;

    public DeleteYourUserTests(PostgresApiFactory factory)
    {
        _factory = factory;
    }

    private static Task<HttpResponseMessage> DeleteYourUser(HttpClient client, string? password) =>
        client.PostAsJsonAsync("/api/user/delete", new { password });

    private static Task<HttpResponseMessage> SignIn(HttpClient client, string email, string password) =>
        client.PostAsJsonAsync("/api/user/sign-in", new { email, password });

    // Who the client is signed in as, or null when it gets 401.
    private static async Task<UserResponse?> WhoAmI(HttpClient client)
    {
        var response = await client.GetAsync("/api/user");
        if (response.StatusCode == HttpStatusCode.Unauthorized)
            return null;
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.Content.ReadFromJsonAsync<UserResponse>();
    }

    [Fact]
    public async Task DeletingTheUser_SignsThisClientOut_AndTheUserCanNoLongerSignIn()
    {
        var email = SignedInClient.UniqueEmail();
        var client = await _factory.CreateSignedInClientAsync(email);

        var response = await DeleteYourUser(client, SignedInClient.Password);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Null(await WhoAmI(client));
        var signIn = await SignIn(_factory.CreateClient(), email, SignedInClient.Password);
        Assert.Equal(HttpStatusCode.Unauthorized, signIn.StatusCode);
        Assert.Equal("Wrong email or password.", (await signIn.Content.ReadFromJsonAsync<ProblemDetails>())!.Detail);
    }

    // Whoever is signed in as the User elsewhere loses it at their very next request, and keeps it
    // lost even once the email signs up again, as a new User.
    [Fact]
    public async Task DeletingTheUser_SignsTheUserOutOfEveryOtherClient()
    {
        var email = SignedInClient.UniqueEmail();
        var client = await _factory.CreateSignedInClientAsync(email);
        var elsewhere = await _factory.CreateClientSignedInAsAsync(email);
        Assert.Equal(email, (await WhoAmI(elsewhere))?.Email);

        Assert.Equal(HttpStatusCode.NoContent, (await DeleteYourUser(client, SignedInClient.Password)).StatusCode);

        Assert.Null(await WhoAmI(elsewhere));
        Assert.Equal(HttpStatusCode.Unauthorized, (await elsewhere.GetAsync("/api/categories")).StatusCode);
        await _factory.CreateSignedInClientAsync(email);
        Assert.Null(await WhoAmI(elsewhere));
    }

    // Each kind of row a User owns, so that deleting the User has to delete every one: Transactions,
    // imported and manually-entered, a Bank Statement and the Upload that imported it, a Category of
    // the User's own, a Categorization Rule, a Receipt kept with the manually-entered Transaction, a
    // Folder, a Bookmark in it, and so the last used folder. Returns the manually-entered
    // Transaction's id.
    private static async Task<int> AddOneOfEverythingAUserOwns(HttpClient client)
    {
        var file = new ByteArrayContent(StatementPdf.WithPurchasesFrom("Kafé", "Rema 1000"));
        file.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
        using var form = new MultipartFormDataContent { { file, "file", "kontoutskrift.pdf" } };
        Assert.Equal(HttpStatusCode.Created, (await client.PostAsync("/api/bank-statements", form)).StatusCode);

        var category = await client.PostAsJsonAsync("/api/categories", new { name = "Hobbies", description = "All hobbies." });
        Assert.Equal(HttpStatusCode.Created, category.StatusCode);
        var categoryId = (await category.Content.ReadFromJsonAsync<CategoryResponse>())!.Id;
        var rule = await client.PostAsJsonAsync("/api/categorization-rules", new { keyword = "kafé", categoryId });
        Assert.Equal(HttpStatusCode.Created, rule.StatusCode);
        var manualId = (await TransactionWithReceipt.CreateAsync(
            client, new { date = "2026-08-20", description = "Garnbutikk", amount = -100m, categoryId })).Id;

        var folder = await client.PostAsJsonAsync("/api/folders", new { name = "Tax deductible" });
        Assert.Equal(HttpStatusCode.Created, folder.StatusCode);
        var folderId = (await folder.Content.ReadFromJsonAsync<FolderResponse>())!.Id;
        Assert.Equal(
            HttpStatusCode.OK,
            (await client.PutAsJsonAsync($"/api/transactions/{manualId}/bookmark", new { folderId })).StatusCode);
        return manualId;
    }

    // Everything the User's data endpoints list, as they answer it.
    private static async Task<List<string>> EverythingListed(HttpClient client)
    {
        string[] urls =
        [
            "/api/categories", "/api/categorization-rules", "/api/transactions/months", "/api/transactions?year=2026&month=8",
            "/api/bank-statements", "/api/folders", "/api/bookmarks", "/api/user/delete-counts",
        ];
        var listed = new List<string>();
        foreach (var url in urls)
            listed.Add(await client.GetStringAsync(url));
        return listed;
    }

    [Fact]
    public async Task DeletingTheUser_DeletesEverythingItOwns_SoItsEmailSignsUpAgainAsANewUserWithOnlyTheSeeds()
    {
        var email = SignedInClient.UniqueEmail();
        var client = await _factory.CreateSignedInClientAsync(email);
        var manualId = await AddOneOfEverythingAUserOwns(client);

        Assert.Equal(HttpStatusCode.NoContent, (await DeleteYourUser(client, SignedInClient.Password)).StatusCode);
        var again = await _factory.CreateSignedInClientAsync(email);

        Assert.Equal(email, (await WhoAmI(again))?.Email);
        Assert.Equal(
            Seeds.Categories.Select(c => c.Name).Order(),
            (await again.GetFromJsonAsync<List<CategoryResponse>>("/api/categories"))!.Select(c => c.Name).Order());
        Assert.Equal(
            Seeds.Rules.Select(r => r.Keyword).Order(),
            (await again.GetFromJsonAsync<List<CategorizationRuleResponse>>("/api/categorization-rules"))!
                .Select(r => r.Keyword).Order());
        Assert.Empty((await again.GetFromJsonAsync<List<TransactionMonthResponse>>("/api/transactions/months"))!);
        Assert.Empty((await again.GetFromJsonAsync<List<ListedBankStatementResponse>>("/api/bank-statements"))!);
        Assert.Empty((await again.GetFromJsonAsync<List<FolderResponse>>("/api/folders"))!);
        Assert.Empty((await again.GetFromJsonAsync<List<TransactionResponse>>("/api/bookmarks"))!);
        Assert.Equal(HttpStatusCode.NotFound, (await again.GetAsync($"/api/transactions/{manualId}/receipt")).StatusCode);
    }

    [Fact]
    public async Task DeletingTheUser_LeavesAnotherUsersDataAsItWas()
    {
        var client = await _factory.CreateSignedInClientAsync();
        var other = await _factory.CreateSignedInClientAsync();
        await AddOneOfEverythingAUserOwns(client);
        var othersManualId = await AddOneOfEverythingAUserOwns(other);
        var before = await EverythingListed(other);

        Assert.Equal(HttpStatusCode.NoContent, (await DeleteYourUser(client, SignedInClient.Password)).StatusCode);

        Assert.Equal(before, await EverythingListed(other));
        Assert.Equal(HttpStatusCode.OK, (await other.GetAsync($"/api/transactions/{othersManualId}/receipt")).StatusCode);
    }

    [Fact]
    public async Task AWrongPassword_IsRefusedOnItsField_AndDeletesNothing()
    {
        var email = SignedInClient.UniqueEmail();
        var client = await _factory.CreateSignedInClientAsync(email);

        var errors = await ValidationErrors(await DeleteYourUser(client, "wrong password"));

        Assert.Equal(["Wrong password."], errors["password"]);
        Assert.Equal(email, (await WhoAmI(client))?.Email);
        Assert.Equal(HttpStatusCode.OK, (await SignIn(_factory.CreateClient(), email, SignedInClient.Password)).StatusCode);
    }

    // Someone with the User's open tab can't guess the password here any more than at Sign in: the
    // failures count towards the same lockout, and a locked email is refused with Sign in's message,
    // here and at Sign in, even with the right password.
    [Fact]
    public async Task WrongPasswords_CountAsFailedSignIns_AndLockTheEmail()
    {
        var email = SignedInClient.UniqueEmail();
        var client = await _factory.CreateSignedInClientAsync(email);

        for (var attempt = 1; attempt < UserSetup.MaxFailedSignIns; attempt++)
            Assert.Equal(HttpStatusCode.BadRequest, (await DeleteYourUser(client, "wrong password")).StatusCode);
        var lastFailure = await DeleteYourUser(client, "wrong password");
        var rightPassword = await DeleteYourUser(client, SignedInClient.Password);

        Assert.Equal(HttpStatusCode.TooManyRequests, lastFailure.StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, rightPassword.StatusCode);
        Assert.Equal(
            "Too many failed sign-ins, so this email is locked for a few minutes. Try again later.",
            (await rightPassword.Content.ReadFromJsonAsync<ProblemDetails>())!.Detail);
        Assert.Equal(
            HttpStatusCode.TooManyRequests, (await SignIn(_factory.CreateClient(), email, SignedInClient.Password)).StatusCode);
        Assert.Equal(email, (await WhoAmI(client))?.Email);
    }

    // Failed sign-ins elsewhere count here too, as they are the same lockout.
    [Fact]
    public async Task AfterFailedSignIns_ALockedEmail_IsRefused_EvenWithTheRightPassword()
    {
        var email = SignedInClient.UniqueEmail();
        var client = await _factory.CreateSignedInClientAsync(email);
        for (var attempt = 1; attempt <= UserSetup.MaxFailedSignIns; attempt++)
            await SignIn(_factory.CreateClient(), email, "wrong password");

        var response = await DeleteYourUser(client, SignedInClient.Password);

        Assert.Equal(HttpStatusCode.TooManyRequests, response.StatusCode);
        Assert.Equal(email, (await WhoAmI(client))?.Email);
    }

    [Fact]
    public async Task AMissingPassword_IsAFieldError()
    {
        var email = SignedInClient.UniqueEmail();
        var client = await _factory.CreateSignedInClientAsync(email);

        var errors = await ValidationErrors(await DeleteYourUser(client, null));

        Assert.Equal(["Password is required."], errors["password"]);
        Assert.Equal(email, (await WhoAmI(client))?.Email);
    }

    // The Guest is shared by every visitor, so nobody can delete it, whatever password is given.
    [Theory]
    [InlineData("")]
    [InlineData(SignedInClient.Password)]
    public async Task TheGuest_IsRefused(string password)
    {
        var client = await _factory.CreateGuestClientAsync();

        var response = await DeleteYourUser(client, password);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal("The Guest can't be deleted.", (await response.Content.ReadFromJsonAsync<ProblemDetails>())!.Detail);
        Assert.Equal(Guest.Email, (await WhoAmI(client))?.Email);
        Assert.Equal(Guest.Email, (await WhoAmI(await _factory.CreateGuestClientAsync()))?.Email);
    }

    [Fact]
    public async Task SignedOut_IsRefused()
    {
        var response = await DeleteYourUser(_factory.CreateClient(), SignedInClient.Password);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // What another site's form would send, with the User's sign-in cookie. The endpoint accepts only
    // JSON, which another site can't send.
    [Fact]
    public async Task DeletingTheUser_FromAForm_IsRefused()
    {
        var email = SignedInClient.UniqueEmail();
        var client = await _factory.CreateSignedInClientAsync(email);

        var response = await client.PostAsync(
            "/api/user/delete", new FormUrlEncodedContent([new("password", SignedInClient.Password)]));

        Assert.False(response.IsSuccessStatusCode);
        Assert.Equal(email, (await WhoAmI(client))?.Email);
    }

    private static async Task<Dictionary<string, string[]>> ValidationErrors(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        return new Dictionary<string, string[]>(problem!.Errors);
    }
}
