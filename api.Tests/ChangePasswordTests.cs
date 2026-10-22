using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc;
using PersonligFinans.Api.Users;

namespace PersonligFinans.Api.Tests;

// Change password: choosing a new password while signed in, by giving the current one.
[Collection(ApiCollection.Name)]
public class ChangePasswordTests
{
    private const string NewPassword = "a brand new passphrase";

    private readonly PostgresApiFactory _factory;

    public ChangePasswordTests(PostgresApiFactory factory)
    {
        _factory = factory;
    }

    private static Task<HttpResponseMessage> ChangePassword(HttpClient client, string? currentPassword, string? newPassword) =>
        client.PostAsJsonAsync("/api/user/change-password", new { currentPassword, newPassword });

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
    public async Task ChangingThePassword_KeepsThisClientSignedIn_AndOnlyTheNewPasswordWorks()
    {
        var email = SignedInClient.UniqueEmail();
        var client = await _factory.CreateSignedInClientAsync(email);

        var response = await ChangePassword(client, SignedInClient.Password, NewPassword);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal(email, (await WhoAmI(client))?.Email);
        Assert.Equal(HttpStatusCode.OK, (await SignIn(_factory.CreateClient(), email, NewPassword)).StatusCode);
        Assert.Equal(
            HttpStatusCode.Unauthorized, (await SignIn(_factory.CreateClient(), email, SignedInClient.Password)).StatusCode);
    }

    // Whoever knew the old password loses the User at once, on their very next request, while this
    // client carries on with a fresh cookie.
    [Fact]
    public async Task ChangingThePassword_SignsTheUserOutOfEveryOtherClient()
    {
        var email = SignedInClient.UniqueEmail();
        var client = await _factory.CreateSignedInClientAsync(email);
        var elsewhere = await _factory.CreateClientSignedInAsAsync(email);
        Assert.Equal(email, (await WhoAmI(elsewhere))?.Email);

        Assert.Equal(HttpStatusCode.NoContent, (await ChangePassword(client, SignedInClient.Password, NewPassword)).StatusCode);

        Assert.Null(await WhoAmI(elsewhere));
        Assert.Equal(HttpStatusCode.Unauthorized, (await elsewhere.GetAsync("/api/categories")).StatusCode);
        Assert.Equal(email, (await WhoAmI(client))?.Email);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/categories")).StatusCode);
    }

    [Fact]
    public async Task AWrongCurrentPassword_IsRefusedOnItsField_AndChangesNothing()
    {
        var email = SignedInClient.UniqueEmail();
        var client = await _factory.CreateSignedInClientAsync(email);

        var errors = await ValidationErrors(await ChangePassword(client, "wrong password", NewPassword));

        Assert.Equal(["Wrong password."], errors["currentPassword"]);
        Assert.False(errors.ContainsKey("newPassword"));
        Assert.Equal(email, (await WhoAmI(client))?.Email);
        Assert.Equal(HttpStatusCode.OK, (await SignIn(_factory.CreateClient(), email, SignedInClient.Password)).StatusCode);
    }

    // Someone with the User's open tab can't guess the password here any more than at Sign in: the
    // failures count towards the same lockout, and a locked email is refused with Sign in's message,
    // here and at Sign in, even with the right password.
    [Fact]
    public async Task WrongCurrentPasswords_CountAsFailedSignIns_AndLockTheEmail()
    {
        var email = SignedInClient.UniqueEmail();
        var client = await _factory.CreateSignedInClientAsync(email);

        for (var attempt = 1; attempt < UserSetup.MaxFailedSignIns; attempt++)
            Assert.Equal(HttpStatusCode.BadRequest, (await ChangePassword(client, "wrong password", NewPassword)).StatusCode);
        var lastFailure = await ChangePassword(client, "wrong password", NewPassword);
        var rightPassword = await ChangePassword(client, SignedInClient.Password, NewPassword);

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

        var response = await ChangePassword(client, SignedInClient.Password, NewPassword);

        Assert.Equal(HttpStatusCode.TooManyRequests, response.StatusCode);
    }

    // Sign up's rules hold whichever way a password is chosen.
    [Fact]
    public async Task ANewPasswordThatIsTooShort_GetsSignUpsFieldError_AndChangesNothing()
    {
        var email = SignedInClient.UniqueEmail();
        var client = await _factory.CreateSignedInClientAsync(email);

        var errors = await ValidationErrors(await ChangePassword(client, SignedInClient.Password, "short"));

        Assert.Equal(["Password must be at least 8 characters."], errors["newPassword"]);
        Assert.False(errors.ContainsKey("currentPassword"));
        Assert.Equal(HttpStatusCode.OK, (await SignIn(_factory.CreateClient(), email, SignedInClient.Password)).StatusCode);
    }

    // Both fields wrong at once are both reported.
    [Fact]
    public async Task AWrongCurrentPassword_AndATooShortNewOne_AreBothReported()
    {
        var client = await _factory.CreateSignedInClientAsync();

        var errors = await ValidationErrors(await ChangePassword(client, "wrong password", "short"));

        Assert.Equal(["Wrong password."], errors["currentPassword"]);
        Assert.Equal(["Password must be at least 8 characters."], errors["newPassword"]);
    }

    [Fact]
    public async Task MissingFields_AreAFieldErrorForEach()
    {
        var client = await _factory.CreateSignedInClientAsync();

        var errors = await ValidationErrors(await ChangePassword(client, "", null));

        Assert.Equal(["Current password is required."], errors["currentPassword"]);
        Assert.Equal(["New password is required."], errors["newPassword"]);
    }

    // The Guest has no password, so nobody can give the shared Guest one.
    [Fact]
    public async Task TheGuest_IsRefused()
    {
        var client = await _factory.CreateGuestClientAsync();

        var response = await ChangePassword(client, "", NewPassword);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal(Guest.Email, (await WhoAmI(client))?.Email);
        Assert.Equal(HttpStatusCode.Unauthorized, (await SignIn(_factory.CreateClient(), Guest.Email, NewPassword)).StatusCode);
    }

    [Fact]
    public async Task SignedOut_IsRefused()
    {
        var response = await ChangePassword(_factory.CreateClient(), SignedInClient.Password, NewPassword);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // What another site's form would send, with the User's sign-in cookie. The endpoint accepts only
    // JSON, which another site can't send.
    [Fact]
    public async Task ChangingThePassword_FromAForm_IsRefused()
    {
        var email = SignedInClient.UniqueEmail();
        var client = await _factory.CreateSignedInClientAsync(email);

        var response = await client.PostAsync(
            "/api/user/change-password",
            new FormUrlEncodedContent([new("currentPassword", SignedInClient.Password), new("newPassword", NewPassword)]));

        Assert.False(response.IsSuccessStatusCode);
        Assert.Equal(HttpStatusCode.OK, (await SignIn(_factory.CreateClient(), email, SignedInClient.Password)).StatusCode);
    }

    private static async Task<Dictionary<string, string[]>> ValidationErrors(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        return new Dictionary<string, string[]>(problem!.Errors);
    }
}
