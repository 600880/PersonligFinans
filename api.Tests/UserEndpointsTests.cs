using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc;
using PersonligFinans.Api.Users;

namespace PersonligFinans.Api.Tests;

[Collection(ApiCollection.Name)]
public class UserEndpointsTests
{
    private const string Password = SignedInClient.Password;

    private readonly PostgresApiFactory _factory;

    public UserEndpointsTests(PostgresApiFactory factory)
    {
        _factory = factory;
    }

    private static Task<HttpResponseMessage> SignUp(HttpClient client, string email, string password) =>
        client.PostAsJsonAsync("/api/user/sign-up", new { email, password });

    private static Task<HttpResponseMessage> SignIn(HttpClient client, string email, string password) =>
        client.PostAsJsonAsync("/api/user/sign-in", new { email, password });

    private static async Task<string?> WhoAmI(HttpClient client)
    {
        var response = await client.GetAsync("/api/user");
        if (response.StatusCode == HttpStatusCode.Unauthorized)
            return null;
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<UserResponse>())!.Email;
    }

    // Signs up a User from a client of its own, so the test's own client stays signed out.
    private async Task<string> SignedUpEmail()
    {
        var email = SignedInClient.UniqueEmail();
        using var client = _factory.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await SignUp(client, email, Password)).StatusCode);
        return email;
    }

    private static async Task<Dictionary<string, string[]>> ValidationErrors(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        return new Dictionary<string, string[]>(problem!.Errors);
    }

    private static async Task<string?> ProblemDetail(HttpResponseMessage response) =>
        (await response.Content.ReadFromJsonAsync<ProblemDetails>())!.Detail;

    [Fact]
    public async Task WhoAmI_SignedOut_Returns401()
    {
        var client = _factory.CreateClient();

        var response = await client.GetAsync("/api/user");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task SignUp_SignsTheNewUserIn()
    {
        var client = _factory.CreateClient();
        var email = SignedInClient.UniqueEmail();

        var response = await SignUp(client, email, Password);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(email, (await response.Content.ReadFromJsonAsync<UserResponse>())!.Email);
        Assert.Equal(email, await WhoAmI(client));
    }

    [Fact]
    public async Task SignUp_SetsAPersistentSecureHttpOnlyLaxCookie()
    {
        var client = _factory.CreateClient();

        var response = await SignUp(client, SignedInClient.UniqueEmail(), Password);

        var cookie = Assert.Single(response.Headers.GetValues("Set-Cookie")).ToLowerInvariant();
        Assert.Contains("httponly", cookie);
        Assert.Contains("secure", cookie);
        Assert.Contains("samesite=lax", cookie);
        Assert.Contains("expires=", cookie);
    }

    [Fact]
    public async Task SignUp_AnEmailAlreadyInUse_IsRefused_IgnoringCase()
    {
        var email = await SignedUpEmail();
        var client = _factory.CreateClient();

        var exact = await ValidationErrors(await SignUp(client, email, Password));
        var otherCase = await ValidationErrors(await SignUp(client, email.ToUpperInvariant(), Password));

        Assert.Equal(["This email is already in use."], exact["email"]);
        Assert.Equal(["This email is already in use."], otherCase["email"]);
        Assert.Null(await WhoAmI(client));
    }

    [Fact]
    public async Task SignUp_AShortPassword_IsRefused()
    {
        var client = _factory.CreateClient();

        var errors = await ValidationErrors(await SignUp(client, SignedInClient.UniqueEmail(), "1234567"));

        Assert.Equal(["Password must be at least 8 characters."], errors["password"]);
        Assert.False(errors.ContainsKey("email"));
        Assert.Null(await WhoAmI(client));
    }

    [Fact]
    public async Task SignUp_APasswordOfEightOfAnyCharacter_IsAccepted()
    {
        var client = _factory.CreateClient();

        var response = await SignUp(client, SignedInClient.UniqueEmail(), "aaaaaaaa");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task SignUp_AnInvalidEmail_IsRefused()
    {
        var client = _factory.CreateClient();

        var errors = await ValidationErrors(await SignUp(client, "not an email", Password));

        Assert.Equal(["Enter a valid email address."], errors["email"]);
    }

    [Fact]
    public async Task SignUp_EveryFieldThatIsWrong_IsReportedAtOnce()
    {
        var email = await SignedUpEmail();
        var client = _factory.CreateClient();

        var errors = await ValidationErrors(await SignUp(client, email, "short"));

        Assert.Equal(["This email is already in use."], errors["email"]);
        Assert.Equal(["Password must be at least 8 characters."], errors["password"]);
    }

    [Fact]
    public async Task SignUp_MissingFields_AreRefused()
    {
        var client = _factory.CreateClient();

        var errors = await ValidationErrors(await SignUp(client, "  ", ""));

        Assert.Equal(["Email is required."], errors["email"]);
        Assert.Equal(["Password is required."], errors["password"]);
    }

    [Fact]
    public async Task SignIn_MatchesTheEmail_IgnoringItsCase()
    {
        var email = await SignedUpEmail();
        var client = _factory.CreateClient();

        var response = await SignIn(client, email.ToUpperInvariant(), Password);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(email, (await response.Content.ReadFromJsonAsync<UserResponse>())!.Email);
        Assert.Equal(email, await WhoAmI(client));
    }

    [Fact]
    public async Task SignIn_AWrongPasswordAndAnUnknownEmail_GetTheSameError()
    {
        var email = await SignedUpEmail();
        var client = _factory.CreateClient();

        var wrongPassword = await SignIn(client, email, "wrong password");
        var unknownEmail = await SignIn(client, SignedInClient.UniqueEmail(), Password);

        Assert.Equal(HttpStatusCode.Unauthorized, wrongPassword.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, unknownEmail.StatusCode);
        Assert.Equal("Wrong email or password.", await ProblemDetail(wrongPassword));
        Assert.Equal("Wrong email or password.", await ProblemDetail(unknownEmail));
        Assert.Null(await WhoAmI(client));
    }

    [Fact]
    public async Task SignIn_AfterFiveFailures_LocksTheEmail_EvenForTheRightPassword()
    {
        var email = await SignedUpEmail();
        var client = _factory.CreateClient();

        for (var attempt = 1; attempt < UserSetup.MaxFailedSignIns; attempt++)
            Assert.Equal(HttpStatusCode.Unauthorized, (await SignIn(client, email, "wrong password")).StatusCode);
        var fifthFailure = await SignIn(client, email, "wrong password");
        var rightPassword = await SignIn(client, email, Password);

        Assert.Equal(HttpStatusCode.TooManyRequests, fifthFailure.StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, rightPassword.StatusCode);
        Assert.Equal(
            "Too many failed sign-ins, so this email is locked for a few minutes. Try again later.",
            await ProblemDetail(rightPassword));
        Assert.Null(await WhoAmI(client));
    }

    [Theory]
    [InlineData(Guest.Email)]
    [InlineData("GUEST@PERSONLIGFINANS.INVALID")]
    [InlineData("someone@personligfinans.invalid")]
    public async Task SignUp_AnEmailOnTheGuestsReservedDomain_IsRefused(string email)
    {
        var client = _factory.CreateClient();

        var errors = await ValidationErrors(await SignUp(client, email, Password));

        Assert.Equal(["This email can't be used."], errors["email"]);
        Assert.Null(await WhoAmI(client));
    }

    [Fact]
    public async Task SignIn_AsTheGuest_GetsTheWrongEmailOrPasswordError_AndNeverLocksIt()
    {
        var client = _factory.CreateClient();

        // More failures than lock any other User's email, and with no password at all.
        var responses = new List<HttpResponseMessage>();
        for (var attempt = 0; attempt <= UserSetup.MaxFailedSignIns; attempt++)
            responses.Add(await SignIn(client, Guest.Email, Password));
        responses.Add(await SignIn(client, Guest.Email.ToUpperInvariant(), " "));

        foreach (var response in responses)
        {
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
            Assert.Equal("Wrong email or password.", await ProblemDetail(response));
        }
        Assert.Null(await WhoAmI(client));
        await _factory.CreateGuestClientAsync();
    }

    [Fact]
    public async Task SignIn_MissingFields_AreRefused()
    {
        var client = _factory.CreateClient();

        var errors = await ValidationErrors(await SignIn(client, "", ""));

        Assert.Equal(["Email is required."], errors["email"]);
        Assert.Equal(["Password is required."], errors["password"]);
    }

    [Fact]
    public async Task SignOut_EndsTheSignIn()
    {
        var client = await _factory.CreateSignedInClientAsync();

        var response = await client.PostAsync("/api/user/sign-out", null);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Null(await WhoAmI(client));
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/categories")).StatusCode);
    }

    [Theory]
    [InlineData("GET", "/api/categories")]
    [InlineData("GET", "/api/categorization-rules")]
    [InlineData("GET", "/api/transactions/months")]
    [InlineData("GET", "/api/spending?year=2026")]
    [InlineData("POST", "/api/transactions")]
    [InlineData("POST", "/api/bank-statements")]
    [InlineData("POST", "/api/receipts/read")]
    [InlineData("GET", "/api/no-such-endpoint")]
    public async Task OtherEndpoints_SignedOut_Return401_NotARedirect(string method, string url)
    {
        var client = _factory.CreateClient();

        var response = await client.SendAsync(new HttpRequestMessage(new HttpMethod(method), url));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task DataEndpoints_SignedIn_Answer()
    {
        var client = await _factory.CreateSignedInClientAsync();

        var response = await client.GetAsync("/api/categories");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }
}
