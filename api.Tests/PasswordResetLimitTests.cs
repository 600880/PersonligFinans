using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using PersonligFinans.Api.Emails;
using PersonligFinans.Api.Users;

namespace PersonligFinans.Api.Tests;

// The caps on reset emails: one per User every few minutes, and a few a day from the whole app.
// Every test class shares one database, and the daily cap counts every reset email sent today. So,
// as in DailyAiLimitTests, each test here sets its clock to a day of its own in 2099, which no other
// test's clock reads: its "today" then holds only its own reset emails, whatever else has run. The
// days are in the future, because signing up runs on the same clock, and the test client would throw
// away a sign-in cookie that has expired by its own, real clock.
// Times are written in Norwegian time: CET in winter.
[Collection(ApiCollection.Name)]
public class PasswordResetLimitTests
{
    private static readonly TimeSpan Cet = TimeSpan.FromHours(1);

    private readonly PostgresApiFactory _factory;

    public PasswordResetLimitTests(PostgresApiFactory factory)
    {
        _factory = factory;
    }

    // An API with the given caps, whose clock is the given one, sending email with the given sender.
    private WebApplicationFactory<Program> Api(
        FakeClock clock, FakeEmailSender sender, int perAddressMinutes, int perDay) =>
        _factory.WithWebHostBuilder(builder =>
        {
            const string section = PasswordResetLimit.SectionName;
            builder.UseSetting($"{section}:{nameof(PasswordResetLimit.PerAddressMinutes)}", Invariant(perAddressMinutes));
            builder.UseSetting($"{section}:{nameof(PasswordResetLimit.PerDay)}", Invariant(perDay));
            builder.UseSetting($"{EmailSetup.SectionName}:AppUrl", "https://personligfinans.example");
            builder.ConfigureTestServices(services =>
            {
                services.AddSingleton<TimeProvider>(clock);
                services.AddSingleton<IEmailSender>(sender);
            });
        });

    // A clock at the given time on the given day of February 2099.
    private static FakeClock OnFebruary(int day, int hour = 12, int minute = 0) =>
        new(new DateTimeOffset(2099, 2, day, hour, minute, 0, Cet));

    private static string Invariant(int number) => number.ToString(CultureInfo.InvariantCulture);

    // Signs up a fresh User and answers its email.
    private static async Task<string> SignUp(WebApplicationFactory<Program> api)
    {
        var email = SignedInClient.UniqueEmail();
        await api.CreateSignedInClientAsync(email);
        return email;
    }

    // Asks for a Password reset for the email, as someone who can't sign in, and checks that the
    // answer is the usual one, whether or not anything was sent.
    private static async Task RequestReset(WebApplicationFactory<Program> api, string email)
    {
        var response = await api.CreateClient().PostAsJsonAsync("/api/user/password-reset/request", new { email });
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    }

    private static List<string> SentTo(FakeEmailSender sender) => sender.Sent.Select(e => e.To).ToList();

    [Fact]
    public async Task ASecondRequestForAnAddress_WithinTheWindow_SendsNothing_AndOneAfterItSends()
    {
        var clock = OnFebruary(1);
        var sender = new FakeEmailSender();
        await using var api = Api(clock, sender, perAddressMinutes: 5, perDay: 100);
        var email = await SignUp(api);

        await RequestReset(api, email);
        clock.Now = clock.Now.AddMinutes(5).AddSeconds(-1);
        await RequestReset(api, email);
        Assert.Single(sender.Sent);

        clock.Now = clock.Now.AddSeconds(1);
        await RequestReset(api, email);
        Assert.Equal([email, email], SentTo(sender));
    }

    [Fact]
    public async Task TheDailyCap_StopsSendingToEveryUser_UntilMidnightInNorway()
    {
        var clock = OnFebruary(2);
        var sender = new FakeEmailSender();
        await using var api = Api(clock, sender, perAddressMinutes: 5, perDay: 2);
        var (a, b, c) = (await SignUp(api), await SignUp(api), await SignUp(api));

        await RequestReset(api, a);
        await RequestReset(api, b);
        await RequestReset(api, c);
        clock.Now = new DateTimeOffset(2099, 2, 2, 23, 59, 59, Cet);
        await RequestReset(api, a);
        await RequestReset(api, c);
        Assert.Equal([a, b], SentTo(sender));

        clock.Now = new DateTimeOffset(2099, 2, 3, 0, 0, 0, Cet);
        await RequestReset(api, c);
        Assert.Equal([a, b, c], SentTo(sender));
    }

    [Fact]
    public async Task OneUsersEmails_DoNotCountAgainstAnothersWindow()
    {
        var clock = OnFebruary(4);
        var sender = new FakeEmailSender();
        await using var api = Api(clock, sender, perAddressMinutes: 5, perDay: 100);
        var (a, b) = (await SignUp(api), await SignUp(api));

        await RequestReset(api, a);
        clock.Now = clock.Now.AddMinutes(1);
        await RequestReset(api, b);

        Assert.Equal([a, b], SentTo(sender));
    }

    // An email that isn't a User's, the Guest's, and another on the Guest's reserved domain send
    // nothing, so they leave the day's one email for a User.
    [Fact]
    public async Task RequestsForEmailsThatArentAUsers_DoNotCountAgainstTheDailyCap()
    {
        var sender = new FakeEmailSender();
        await using var api = Api(OnFebruary(5), sender, perAddressMinutes: 5, perDay: 1);
        var email = await SignUp(api);

        await RequestReset(api, "nobody-signed-up-with-this@example.com");
        await RequestReset(api, Guest.Email);
        await RequestReset(api, "someone@personligfinans.invalid");
        await RequestReset(api, email);

        Assert.Equal([email], SentTo(sender));
    }

    // Had the request at 12:03 counted, the User would get nothing until 12:08.
    [Fact]
    public async Task ARequestWithinTheWindow_DoesNotStartItAgain()
    {
        var clock = OnFebruary(6, 12, 0);
        var sender = new FakeEmailSender();
        await using var api = Api(clock, sender, perAddressMinutes: 5, perDay: 100);
        var email = await SignUp(api);

        await RequestReset(api, email);
        clock.Now = clock.Now.AddMinutes(3);
        await RequestReset(api, email);
        clock.Now = clock.Now.AddMinutes(2);
        await RequestReset(api, email);

        Assert.Equal([email, email], SentTo(sender));
    }

    // Had the request at 23:58 counted, the User would get nothing until 00:03.
    [Fact]
    public async Task ARequestOverTheDailyCap_DoesNotStartTheUsersWindow()
    {
        var clock = OnFebruary(7, 12, 0);
        var sender = new FakeEmailSender();
        await using var api = Api(clock, sender, perAddressMinutes: 5, perDay: 1);
        var (a, b) = (await SignUp(api), await SignUp(api));

        await RequestReset(api, a);
        clock.Now = new DateTimeOffset(2099, 2, 7, 23, 58, 0, Cet);
        await RequestReset(api, b);
        clock.Now = new DateTimeOffset(2099, 2, 8, 0, 0, 0, Cet);
        await RequestReset(api, b);

        Assert.Equal([a, b], SentTo(sender));
    }

    // The window runs on past midnight, although the day's count starts again.
    [Fact]
    public async Task TheWindow_SpansMidnight()
    {
        var clock = new FakeClock(new DateTimeOffset(2099, 2, 9, 23, 58, 0, Cet));
        var sender = new FakeEmailSender();
        await using var api = Api(clock, sender, perAddressMinutes: 5, perDay: 100);
        var (a, b) = (await SignUp(api), await SignUp(api));

        await RequestReset(api, a);
        clock.Now = new DateTimeOffset(2099, 2, 10, 0, 1, 0, Cet);
        // Sending to B records an email, the moment old ones are deleted.
        await RequestReset(api, b);
        await RequestReset(api, a);
        Assert.Equal([a, b], SentTo(sender));

        clock.Now = new DateTimeOffset(2099, 2, 10, 0, 3, 0, Cet);
        await RequestReset(api, a);
        Assert.Equal([a, b, a], SentTo(sender));
    }

    // Sending is tried, so the email counts against both caps, though nobody got it.
    [Fact]
    public async Task AnEmailThatFailsToSend_StillCounts_AndTheAnswerIsTheSame()
    {
        var clock = OnFebruary(11);
        var sender = new FakeEmailSender { Failing = true };
        await using var api = Api(clock, sender, perAddressMinutes: 5, perDay: 2);
        var (a, b, c) = (await SignUp(api), await SignUp(api), await SignUp(api));

        await RequestReset(api, a);
        clock.Now = clock.Now.AddMinutes(1);
        await RequestReset(api, a);
        await RequestReset(api, b);
        await RequestReset(api, c);

        Assert.Equal([a, b], SentTo(sender));
    }

    // Otherwise deleting a User could raise the day's email-sending past the cap.
    [Fact]
    public async Task ADeletedUsersEmails_StillCountAgainstTheDailyCap()
    {
        var sender = new FakeEmailSender();
        await using var api = Api(OnFebruary(13), sender, perAddressMinutes: 5, perDay: 1);
        var deletedEmail = SignedInClient.UniqueEmail();
        var deleted = await api.CreateSignedInClientAsync(deletedEmail);
        var other = await SignUp(api);

        await RequestReset(api, deletedEmail);
        var deleting = await deleted.PostAsJsonAsync("/api/user/delete", new { password = SignedInClient.Password });
        Assert.Equal(HttpStatusCode.NoContent, deleting.StatusCode);
        await RequestReset(api, other);

        Assert.Equal([deletedEmail], SentTo(sender));
    }

    [Fact]
    public async Task ConcurrentRequestsForAnAddress_SendOneEmail()
    {
        var sender = new FakeEmailSender();
        await using var api = Api(OnFebruary(12), sender, perAddressMinutes: 5, perDay: 100);
        var email = await SignUp(api);

        await Task.WhenAll(Enumerable.Range(0, 10).Select(_ => RequestReset(api, email)));

        Assert.Equal([email], SentTo(sender));
    }
}
