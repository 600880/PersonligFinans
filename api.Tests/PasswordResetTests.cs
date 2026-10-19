using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.DependencyInjection;
using PersonligFinans.Api.Emails;
using PersonligFinans.Api.Users;

namespace PersonligFinans.Api.Tests;

// Asking for a Password reset: the email with a link to choose a new password, sent only to a
// User's email, and the same answer for every email.
[Collection(ApiCollection.Name)]
public class PasswordResetTests
{
    private const string AppUrl = "https://personligfinans.example";

    private readonly PostgresApiFactory _factory;

    public PasswordResetTests(PostgresApiFactory factory)
    {
        _factory = factory;
    }

    // An API that sends email with the given sender, from the app at AppUrl.
    private WebApplicationFactory<Program> Api(FakeEmailSender sender) =>
        _factory.WithWebHostBuilder(builder =>
        {
            builder.UseSetting($"{EmailSetup.SectionName}:AppUrl", AppUrl);
            builder.ConfigureTestServices(services => services.AddSingleton<IEmailSender>(sender));
        });

    private static async Task<bool> IsAvailable(HttpClient client)
    {
        var response = await client.GetAsync("/api/user/password-reset/availability");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<PasswordResetAvailability>())!.Available;
    }

    private static Task<HttpResponseMessage> RequestReset(HttpClient client, string email) =>
        client.PostAsJsonAsync("/api/user/password-reset/request", new { email });

    // The email and the token in the link to choose a new password, the only link in the plain text,
    // as the page the link opens reads them: the token still base64url-encoded.
    private static (string Email, string Token) LinkQuery(OutgoingEmail email)
    {
        var link = new Uri(Regex.Match(email.PlainText, @"https://\S+").Value);
        Assert.Equal($"{AppUrl}/reset-password", link.GetLeftPart(UriPartial.Path));
        var query = QueryHelpers.ParseQuery(link.Query);
        return (query["email"].Single()!, query["token"].Single()!);
    }

    // The link's email and token, with the token decoded back into the one Identity gave.
    private static (string Email, string Token) ResetLink(OutgoingEmail email)
    {
        var (linkEmail, token) = LinkQuery(email);
        return (linkEmail, Encoding.UTF8.GetString(WebEncoders.Base64UrlDecode(token)));
    }

    private static Task<HttpResponseMessage> ChooseNewPassword(
        HttpClient client, string email, string token, string password) =>
        client.PostAsJsonAsync("/api/user/password-reset/new-password", new { email, token, password });

    // Asks for a link for the User's email and answers the email and token in it, as the page the
    // link opens reads them.
    private static async Task<(string Email, string Token)> FollowNewLink(
        WebApplicationFactory<Program> api, FakeEmailSender sender, string email)
    {
        Assert.Equal(HttpStatusCode.NoContent, (await RequestReset(api.CreateClient(), email)).StatusCode);
        return LinkQuery(sender.Sent[^1]);
    }

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

    private const string NewPassword = "a brand new passphrase";

    // Resets the password with the token, as the page the link opens will, and answers whether
    // Identity accepted it.
    private static async Task<bool> ResetsThePassword(WebApplicationFactory<Program> api, string email, string token, string password)
    {
        using var scope = api.Services.CreateScope();
        var userManager = scope.ServiceProvider.GetRequiredService<UserManager<IdentityUser>>();
        var user = await userManager.FindByEmailAsync(email);
        return (await userManager.ResetPasswordAsync(user!, token, password)).Succeeded;
    }

    [Fact]
    public async Task Availability_WithAnEmailSender_IsAvailable_ToAnyone()
    {
        await using var api = Api(new FakeEmailSender());

        Assert.True(await IsAvailable(api.CreateClient()));
    }

    // As the email says, so the landing page can say it too.
    [Fact]
    public async Task Availability_SaysALinkWorksForAnHour()
    {
        await using var api = Api(new FakeEmailSender());

        var availability = await api.CreateClient()
            .GetFromJsonAsync<PasswordResetAvailability>("/api/user/password-reset/availability");

        Assert.Equal(1, availability!.LinkHours);
    }

    [Fact]
    public async Task Availability_WithoutAnEmailSender_IsUnavailable()
    {
        Assert.False(await IsAvailable(_factory.CreateClient()));
    }

    [Fact]
    public async Task RequestingAReset_WithoutAnEmailSender_Returns503()
    {
        var response = await RequestReset(_factory.CreateClient(), SignedInClient.UniqueEmail());

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
    }

    [Fact]
    public async Task RequestingAReset_ForAUsersEmail_InAnyCase_SendsOneEmail_WhoseLinkResetsThePassword()
    {
        var sender = new FakeEmailSender();
        await using var api = Api(sender);
        var email = SignedInClient.UniqueEmail();
        await api.CreateSignedInClientAsync(email);

        var response = await RequestReset(api.CreateClient(), $"  {email.ToUpperInvariant()} ");

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        var sent = Assert.Single(sender.Sent);
        Assert.Equal(email, sent.To);
        var (linkEmail, token) = ResetLink(sent);
        Assert.Equal(email, linkEmail);
        Assert.True(await ResetsThePassword(api, email, token, "a brand new passphrase"));
        var signIn = await api.CreateClient().PostAsJsonAsync(
            "/api/user/sign-in", new { email, password = "a brand new passphrase" });
        Assert.Equal(HttpStatusCode.OK, signIn.StatusCode);
    }

    [Fact]
    public async Task TheEmail_SaysWhatTheLinkIsFor_InPlainTextAndHtml_LinkingToTheAppsAddress_NotTheRequestsHost()
    {
        var sender = new FakeEmailSender();
        await using var api = Api(sender);
        var email = SignedInClient.UniqueEmail();
        await api.CreateSignedInClientAsync(email);
        var client = api.CreateClient();
        client.DefaultRequestHeaders.Host = "attacker.example";

        Assert.Equal(HttpStatusCode.NoContent, (await RequestReset(client, email)).StatusCode);

        var sent = Assert.Single(sender.Sent);
        var link = Regex.Match(sent.PlainText, @"https://\S+").Value;
        Assert.StartsWith($"{AppUrl}/reset-password?email=", link);
        Assert.Equal("Reset your PersonligFinans password", sent.Subject);
        Assert.Equal(
            "Someone asked to reset the PersonligFinans password for this email, so here is a link to choose a new one:\n\n" +
            $"{link}\n\nIt works for 1 hour.\n\nIf you didn't ask for this, ignore this email.\n",
            sent.PlainText);
        Assert.Contains($"<a href=\"{link.Replace("&", "&amp;")}\">", sent.Html);
        Assert.Contains("<p>It works for 1 hour.</p>", sent.Html);
        Assert.Contains("<p>If you didn&#39;t ask for this, ignore this email.</p>", sent.Html);
        Assert.DoesNotContain("attacker.example", sent.PlainText + sent.Html);
    }

    // An email nobody signed up with, the Guest's, which has no password, and another on the Guest's
    // reserved domain.
    [Theory]
    [InlineData("nobody-signed-up-with-this@example.com")]
    [InlineData(Guest.Email)]
    [InlineData("GUEST@PERSONLIGFINANS.INVALID")]
    [InlineData("someone@personligfinans.invalid")]
    public async Task RequestingAReset_ForAnEmailThatIsntAUsers_AnswersTheSame_AndSendsNothing(string email)
    {
        var sender = new FakeEmailSender();
        await using var api = Api(sender);

        var response = await RequestReset(api.CreateClient(), email);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Empty(sender.Sent);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public async Task RequestingAReset_WithoutAnEmail_IsAFieldError(string? email)
    {
        var sender = new FakeEmailSender();
        await using var api = Api(sender);

        var response = await api.CreateClient().PostAsJsonAsync("/api/user/password-reset/request", new { email });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        Assert.Equal(["Email is required."], problem!.Errors["email"]);
        Assert.Empty(sender.Sent);
    }

    [Fact]
    public async Task RequestingAReset_WhenSendingFails_AnswersTheSame()
    {
        var sender = new FakeEmailSender { Failing = true };
        await using var api = Api(sender);
        var email = SignedInClient.UniqueEmail();
        await api.CreateSignedInClientAsync(email);

        var response = await RequestReset(api.CreateClient(), email);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Single(sender.Sent);
    }

    // What another site's form would send. The endpoint accepts only JSON, so a form matches no
    // endpoint and gets whatever an unknown API path gets.
    [Fact]
    public async Task RequestingAReset_FromAForm_IsRefused()
    {
        var sender = new FakeEmailSender();
        await using var api = Api(sender);
        var email = SignedInClient.UniqueEmail();
        await api.CreateSignedInClientAsync(email);

        var response = await api.CreateClient().PostAsync(
            "/api/user/password-reset/request", new FormUrlEncodedContent([new("email", email)]));

        Assert.False(response.IsSuccessStatusCode);
        Assert.Empty(sender.Sent);
    }

    [Fact]
    public async Task ChoosingANewPassword_FromTheLink_SignsInAsTheUser_AndOnlyTheNewPasswordWorks()
    {
        var sender = new FakeEmailSender();
        await using var api = Api(sender);
        var email = SignedInClient.UniqueEmail();
        await api.CreateSignedInClientAsync(email);
        var (linkEmail, token) = await FollowNewLink(api, sender, email);
        var client = api.CreateClient();

        var response = await ChooseNewPassword(client, linkEmail, token, NewPassword);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(new UserResponse(email, false), await response.Content.ReadFromJsonAsync<UserResponse>());
        Assert.Equal(email, (await WhoAmI(client))?.Email);
        Assert.Equal(HttpStatusCode.OK, (await SignIn(api.CreateClient(), email, NewPassword)).StatusCode);
        Assert.Equal(
            HttpStatusCode.Unauthorized, (await SignIn(api.CreateClient(), email, SignedInClient.Password)).StatusCode);
    }

    // A reset is the way out of a lockout, without waiting for it to end.
    [Fact]
    public async Task ChoosingANewPassword_ForALockedEmail_EndsTheLockout()
    {
        var sender = new FakeEmailSender();
        await using var api = Api(sender);
        var email = SignedInClient.UniqueEmail();
        await api.CreateSignedInClientAsync(email);
        for (var attempt = 1; attempt <= UserSetup.MaxFailedSignIns; attempt++)
            await SignIn(api.CreateClient(), email, "wrong password");
        Assert.Equal(
            HttpStatusCode.TooManyRequests, (await SignIn(api.CreateClient(), email, SignedInClient.Password)).StatusCode);
        var (_, token) = await FollowNewLink(api, sender, email);

        Assert.Equal(HttpStatusCode.OK, (await ChooseNewPassword(api.CreateClient(), email, token, NewPassword)).StatusCode);

        Assert.Equal(HttpStatusCode.Unauthorized, (await SignIn(api.CreateClient(), email, "wrong password")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await SignIn(api.CreateClient(), email, NewPassword)).StatusCode);
    }

    // Failures before the reset are forgotten, so one more afterwards doesn't lock the email.
    [Fact]
    public async Task ChoosingANewPassword_StartsCountingFailedSignInsAfresh()
    {
        var sender = new FakeEmailSender();
        await using var api = Api(sender);
        var email = SignedInClient.UniqueEmail();
        await api.CreateSignedInClientAsync(email);
        for (var attempt = 1; attempt < UserSetup.MaxFailedSignIns; attempt++)
            await SignIn(api.CreateClient(), email, "wrong password");
        var (_, token) = await FollowNewLink(api, sender, email);

        Assert.Equal(HttpStatusCode.OK, (await ChooseNewPassword(api.CreateClient(), email, token, NewPassword)).StatusCode);

        Assert.Equal(HttpStatusCode.Unauthorized, (await SignIn(api.CreateClient(), email, "wrong password")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await SignIn(api.CreateClient(), email, NewPassword)).StatusCode);
    }

    // Whoever knew the old password loses the User at once, on their very next request.
    [Fact]
    public async Task ChoosingANewPassword_SignsTheUserOutOfEveryOtherClient()
    {
        var sender = new FakeEmailSender();
        await using var api = Api(sender);
        var email = SignedInClient.UniqueEmail();
        var elsewhere = await api.CreateSignedInClientAsync(email);
        Assert.Equal(email, (await WhoAmI(elsewhere))?.Email);
        var (_, token) = await FollowNewLink(api, sender, email);
        var client = api.CreateClient();

        Assert.Equal(HttpStatusCode.OK, (await ChooseNewPassword(client, email, token, NewPassword)).StatusCode);

        Assert.Null(await WhoAmI(elsewhere));
        Assert.Equal(HttpStatusCode.Unauthorized, (await elsewhere.GetAsync("/api/categories")).StatusCode);
        Assert.Equal(email, (await WhoAmI(client))?.Email);
    }

    // Following the link on a browser signed in as the Guest ends up in the User, not the Guest.
    [Fact]
    public async Task ChoosingANewPassword_WhileSignedInAsTheGuest_SignsInAsTheUserInstead()
    {
        var sender = new FakeEmailSender();
        await using var api = Api(sender);
        var email = SignedInClient.UniqueEmail();
        await api.CreateSignedInClientAsync(email);
        var (_, token) = await FollowNewLink(api, sender, email);
        var client = await api.CreateGuestClientAsync();

        var response = await ChooseNewPassword(client, email, token, NewPassword);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(new UserResponse(email, false), await WhoAmI(client));
    }

    // Identity's token provider reads the system clock rather than the injected TimeProvider, so
    // this API's links work for a moment rather than an hour, and the test waits that moment out.
    [Fact]
    public async Task ChoosingANewPassword_WithALinkPastItsLifespan_IsRefused()
    {
        var sender = new FakeEmailSender();
        await using var api = Api(sender).WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
                services.Configure<DataProtectionTokenProviderOptions>(options =>
                    options.TokenLifespan = TimeSpan.FromMilliseconds(100))));
        var email = SignedInClient.UniqueEmail();
        await api.CreateSignedInClientAsync(email);
        var (_, token) = await FollowNewLink(api, sender, email);
        await Task.Delay(TimeSpan.FromMilliseconds(200));
        var client = api.CreateClient();

        var response = await ChooseNewPassword(client, email, token, NewPassword);

        await AssertExpiredOrUsed(response, client);
        Assert.Equal(HttpStatusCode.OK, (await SignIn(api.CreateClient(), email, SignedInClient.Password)).StatusCode);
    }

    // The one answer for every link that can't reset a password, whatever is wrong with it, so it
    // never tells whether the email is a User's. Nobody is signed in by it, and the User's password
    // is unchanged.
    private static async Task AssertExpiredOrUsed(HttpResponseMessage response, HttpClient client)
    {
        Assert.Equal(HttpStatusCode.Gone, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ProblemDetails>();
        Assert.Equal("This link has expired or was already used.", problem!.Detail);
        Assert.Null(await WhoAmI(client));
    }

    [Fact]
    public async Task ChoosingANewPassword_WithALinkAlreadyUsed_IsRefused()
    {
        var sender = new FakeEmailSender();
        await using var api = Api(sender);
        var email = SignedInClient.UniqueEmail();
        await api.CreateSignedInClientAsync(email);
        var (linkEmail, token) = await FollowNewLink(api, sender, email);
        Assert.Equal(HttpStatusCode.OK, (await ChooseNewPassword(api.CreateClient(), linkEmail, token, NewPassword)).StatusCode);
        var client = api.CreateClient();

        var response = await ChooseNewPassword(client, linkEmail, token, "yet another passphrase");

        await AssertExpiredOrUsed(response, client);
        Assert.Equal(HttpStatusCode.OK, (await SignIn(api.CreateClient(), email, NewPassword)).StatusCode);
    }

    // Asking for a second link leaves the first working, but only until the password changes.
    [Fact]
    public async Task ChoosingANewPassword_WithALinkFromBeforeALaterReset_IsRefused()
    {
        var sender = new FakeEmailSender();
        await using var api = Api(sender);
        var email = SignedInClient.UniqueEmail();
        await api.CreateSignedInClientAsync(email);
        var (_, firstToken) = await FollowNewLink(api, sender, email);
        var (_, secondToken) = await FollowNewLink(api, sender, email);
        Assert.Equal(HttpStatusCode.OK, (await ChooseNewPassword(api.CreateClient(), email, secondToken, NewPassword)).StatusCode);
        var client = api.CreateClient();

        var response = await ChooseNewPassword(client, email, firstToken, "yet another passphrase");

        await AssertExpiredOrUsed(response, client);
        Assert.Equal(HttpStatusCode.OK, (await SignIn(api.CreateClient(), email, NewPassword)).StatusCode);
    }

    // A token with one character changed, and one that isn't base64url at all.
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task ChoosingANewPassword_WithATamperedToken_IsRefused(bool notBase64Url)
    {
        var sender = new FakeEmailSender();
        await using var api = Api(sender);
        var email = SignedInClient.UniqueEmail();
        await api.CreateSignedInClientAsync(email);
        var (_, token) = await FollowNewLink(api, sender, email);
        var tampered = notBase64Url
            ? "not a token!"
            : token[..20] + (token[20] == 'A' ? 'B' : 'A') + token[21..];
        var client = api.CreateClient();

        var response = await ChooseNewPassword(client, email, tampered, NewPassword);

        await AssertExpiredOrUsed(response, client);
        Assert.Equal(HttpStatusCode.OK, (await SignIn(api.CreateClient(), email, SignedInClient.Password)).StatusCode);
    }

    [Fact]
    public async Task ChoosingANewPassword_WithAnotherUsersEmail_IsRefused()
    {
        var sender = new FakeEmailSender();
        await using var api = Api(sender);
        var email = SignedInClient.UniqueEmail();
        var otherEmail = SignedInClient.UniqueEmail();
        await api.CreateSignedInClientAsync(email);
        await api.CreateSignedInClientAsync(otherEmail);
        var (_, token) = await FollowNewLink(api, sender, email);
        var client = api.CreateClient();

        var response = await ChooseNewPassword(client, otherEmail, token, NewPassword);

        await AssertExpiredOrUsed(response, client);
        Assert.Equal(HttpStatusCode.OK, (await SignIn(api.CreateClient(), otherEmail, SignedInClient.Password)).StatusCode);
    }

    // The link still works afterwards, so the User can try a longer one.
    [Fact]
    public async Task ChoosingANewPassword_ThatIsTooShort_GetsSignUpsFieldError()
    {
        var sender = new FakeEmailSender();
        await using var api = Api(sender);
        var email = SignedInClient.UniqueEmail();
        await api.CreateSignedInClientAsync(email);
        var (_, token) = await FollowNewLink(api, sender, email);
        var client = api.CreateClient();

        var response = await ChooseNewPassword(client, email, token, "short");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        Assert.Equal(["Password must be at least 8 characters."], problem!.Errors["password"]);
        Assert.Null(await WhoAmI(client));
        Assert.Equal(HttpStatusCode.OK, (await ChooseNewPassword(client, email, token, NewPassword)).StatusCode);
    }

    [Fact]
    public async Task ChoosingANewPassword_WithoutTheFields_IsAFieldErrorForEach()
    {
        await using var api = Api(new FakeEmailSender());

        var response = await api.CreateClient().PostAsJsonAsync(
            "/api/user/password-reset/new-password", new { email = "  ", token = "", password = (string?)null });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        Assert.Equal(["Email is required."], problem!.Errors["email"]);
        Assert.Equal(["Token is required."], problem.Errors["token"]);
        Assert.Equal(["Password is required."], problem.Errors["password"]);
    }

    [Fact]
    public async Task ChoosingANewPassword_WithoutAnEmailSender_Returns503()
    {
        var response = await ChooseNewPassword(_factory.CreateClient(), SignedInClient.UniqueEmail(), "token", NewPassword);

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
    }

    // What another site's form would send, as for asking for a link.
    [Fact]
    public async Task ChoosingANewPassword_FromAForm_IsRefused()
    {
        var sender = new FakeEmailSender();
        await using var api = Api(sender);
        var email = SignedInClient.UniqueEmail();
        await api.CreateSignedInClientAsync(email);
        var (_, token) = await FollowNewLink(api, sender, email);
        var client = api.CreateClient();

        var response = await client.PostAsync(
            "/api/user/password-reset/new-password",
            new FormUrlEncodedContent([new("email", email), new("token", token), new("password", NewPassword)]));

        Assert.False(response.IsSuccessStatusCode);
        Assert.Null(await WhoAmI(client));
    }

    // An email nobody signed up with, the Guest's, which has no password, and another on the Guest's
    // reserved domain, each with a token that works for a User.
    [Theory]
    [InlineData("nobody-signed-up-with-this@example.com")]
    [InlineData(Guest.Email)]
    [InlineData("someone@personligfinans.invalid")]
    public async Task ChoosingANewPassword_ForAnEmailThatIsntAUsers_AnswersTheSame(string email)
    {
        var sender = new FakeEmailSender();
        await using var api = Api(sender);
        var userEmail = SignedInClient.UniqueEmail();
        await api.CreateSignedInClientAsync(userEmail);
        var (_, token) = await FollowNewLink(api, sender, userEmail);
        var client = api.CreateClient();

        var response = await ChooseNewPassword(client, email, token, NewPassword);

        await AssertExpiredOrUsed(response, client);
    }

    // An API configured to send email through Communication Services with these settings, the
    // others left out.
    private WebApplicationFactory<Program> ApiWithEmailSettings(Dictionary<string, string> settings) =>
        _factory.WithWebHostBuilder(builder =>
        {
            foreach (var (key, value) in settings)
                builder.UseSetting($"{EmailSetup.SectionName}:{key}", value);
        });

    // Sends nothing: making the sender reaches no Azure resource.
    [Fact]
    public async Task Availability_WithEmailConfigured_IsAvailable()
    {
        await using var api = ApiWithEmailSettings(new()
        {
            ["Endpoint"] = "https://personligfinans.europe.communication.azure.com",
            ["Sender"] = "DoNotReply@example.azurecomm.net",
            ["AppUrl"] = AppUrl,
        });

        Assert.True(await IsAvailable(api.CreateClient()));
    }

    [Theory]
    [InlineData("Sender", "", "Email:Sender")]
    [InlineData("AppUrl", "", "Email:AppUrl")]
    [InlineData("AppUrl", "personligfinans.example", "Email:AppUrl")]
    public async Task StartUp_WithAnEmailEndpoint_ButAMissingOrInvalidSetting_FailsNamingIt(
        string setting, string value, string named)
    {
        var settings = new Dictionary<string, string>
        {
            ["Endpoint"] = "https://personligfinans.europe.communication.azure.com",
            ["Sender"] = "DoNotReply@example.azurecomm.net",
            ["AppUrl"] = AppUrl,
        };
        settings[setting] = value;
        await using var api = ApiWithEmailSettings(settings);

        var error = Assert.Throws<InvalidOperationException>(() => api.CreateClient());

        Assert.Contains($"'{named}'", error.Message);
    }
}
