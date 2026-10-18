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

    private static Task<HttpResponseMessage> Register(HttpClient client, string email, string password) =>
        client.PostAsJsonAsync("/api/user/register", new { email, password });

    private static Task<HttpResponseMessage> LogIn(HttpClient client, string email, string password) =>
        client.PostAsJsonAsync("/api/user/log-in", new { email, password });

    private static async Task<string?> WhoAmI(HttpClient client)
    {
        var response = await client.GetAsync("/api/user");
        if (response.StatusCode == HttpStatusCode.Unauthorized)
            return null;
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<UserResponse>())!.Email;
    }

    // Registers a User from a client of its own, so the test's own client stays signed out.
    private async Task<string> RegisteredEmail()
    {
        var email = SignedInClient.UniqueEmail();
        using var client = _factory.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await Register(client, email, Password)).StatusCode);
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
    public async Task Register_SignsTheNewUserIn()
    {
        var client = _factory.CreateClient();
        var email = SignedInClient.UniqueEmail();

        var response = await Register(client, email, Password);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(email, (await response.Content.ReadFromJsonAsync<UserResponse>())!.Email);
        Assert.Equal(email, await WhoAmI(client));
    }

    [Fact]
    public async Task Register_SetsAPersistentSecureHttpOnlyLaxCookie()
    {
        var client = _factory.CreateClient();

        var response = await Register(client, SignedInClient.UniqueEmail(), Password);

        var cookie = Assert.Single(response.Headers.GetValues("Set-Cookie")).ToLowerInvariant();
        Assert.Contains("httponly", cookie);
        Assert.Contains("secure", cookie);
        Assert.Contains("samesite=lax", cookie);
        Assert.Contains("expires=", cookie);
    }

    [Fact]
    public async Task Register_AnEmailAlreadyRegistered_IsRefused_IgnoringCase()
    {
        var email = await RegisteredEmail();
        var client = _factory.CreateClient();

        var exact = await ValidationErrors(await Register(client, email, Password));
        var otherCase = await ValidationErrors(await Register(client, email.ToUpperInvariant(), Password));

        Assert.Equal(["This email is already registered."], exact["email"]);
        Assert.Equal(["This email is already registered."], otherCase["email"]);
        Assert.Null(await WhoAmI(client));
    }

    [Fact]
    public async Task Register_AShortPassword_IsRefused()
    {
        var client = _factory.CreateClient();

        var errors = await ValidationErrors(await Register(client, SignedInClient.UniqueEmail(), "1234567"));

        Assert.Equal(["Password must be at least 8 characters."], errors["password"]);
        Assert.False(errors.ContainsKey("email"));
        Assert.Null(await WhoAmI(client));
    }

    [Fact]
    public async Task Register_APasswordOfEightOfAnyCharacter_IsAccepted()
    {
        var client = _factory.CreateClient();

        var response = await Register(client, SignedInClient.UniqueEmail(), "aaaaaaaa");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Register_AnInvalidEmail_IsRefused()
    {
        var client = _factory.CreateClient();

        var errors = await ValidationErrors(await Register(client, "not an email", Password));

        Assert.Equal(["Enter a valid email address."], errors["email"]);
    }

    [Fact]
    public async Task Register_EveryFieldThatIsWrong_IsReportedAtOnce()
    {
        var email = await RegisteredEmail();
        var client = _factory.CreateClient();

        var errors = await ValidationErrors(await Register(client, email, "short"));

        Assert.Equal(["This email is already registered."], errors["email"]);
        Assert.Equal(["Password must be at least 8 characters."], errors["password"]);
    }

    [Fact]
    public async Task Register_MissingFields_AreRefused()
    {
        var client = _factory.CreateClient();

        var errors = await ValidationErrors(await Register(client, "  ", ""));

        Assert.Equal(["Email is required."], errors["email"]);
        Assert.Equal(["Password is required."], errors["password"]);
    }

    [Fact]
    public async Task LogIn_SignsIn_IgnoringTheEmailsCase()
    {
        var email = await RegisteredEmail();
        var client = _factory.CreateClient();

        var response = await LogIn(client, email.ToUpperInvariant(), Password);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(email, (await response.Content.ReadFromJsonAsync<UserResponse>())!.Email);
        Assert.Equal(email, await WhoAmI(client));
    }

    [Fact]
    public async Task LogIn_AWrongPasswordAndAnUnknownEmail_GetTheSameError()
    {
        var email = await RegisteredEmail();
        var client = _factory.CreateClient();

        var wrongPassword = await LogIn(client, email, "wrong password");
        var unknownEmail = await LogIn(client, SignedInClient.UniqueEmail(), Password);

        Assert.Equal(HttpStatusCode.Unauthorized, wrongPassword.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, unknownEmail.StatusCode);
        Assert.Equal("Wrong email or password.", await ProblemDetail(wrongPassword));
        Assert.Equal("Wrong email or password.", await ProblemDetail(unknownEmail));
        Assert.Null(await WhoAmI(client));
    }

    [Fact]
    public async Task LogIn_AfterFiveFailures_LocksTheEmail_EvenForTheRightPassword()
    {
        var email = await RegisteredEmail();
        var client = _factory.CreateClient();

        for (var attempt = 1; attempt < UserSetup.MaxFailedLogIns; attempt++)
            Assert.Equal(HttpStatusCode.Unauthorized, (await LogIn(client, email, "wrong password")).StatusCode);
        var fifthFailure = await LogIn(client, email, "wrong password");
        var rightPassword = await LogIn(client, email, Password);

        Assert.Equal(HttpStatusCode.TooManyRequests, fifthFailure.StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, rightPassword.StatusCode);
        Assert.Equal(
            "Too many failed log-ins, so this email is locked for a few minutes. Try again later.",
            await ProblemDetail(rightPassword));
        Assert.Null(await WhoAmI(client));
    }

    [Fact]
    public async Task LogIn_MissingFields_AreRefused()
    {
        var client = _factory.CreateClient();

        var errors = await ValidationErrors(await LogIn(client, "", ""));

        Assert.Equal(["Email is required."], errors["email"]);
        Assert.Equal(["Password is required."], errors["password"]);
    }

    [Fact]
    public async Task LogOut_EndsTheSignIn()
    {
        var client = await _factory.CreateSignedInClientAsync();

        var response = await client.PostAsync("/api/user/log-out", null);

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
