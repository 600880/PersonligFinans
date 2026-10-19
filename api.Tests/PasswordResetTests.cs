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
    // with the token decoded back into the one Identity gave.
    private static (string Email, string Token) ResetLink(OutgoingEmail email)
    {
        var link = new Uri(Regex.Match(email.PlainText, @"https://\S+").Value);
        Assert.Equal($"{AppUrl}/reset-password", link.GetLeftPart(UriPartial.Path));
        var query = QueryHelpers.ParseQuery(link.Query);
        var token = Encoding.UTF8.GetString(WebEncoders.Base64UrlDecode(query["token"].Single()!));
        return (query["email"].Single()!, token);
    }

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
