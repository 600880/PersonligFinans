using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using PersonligFinans.Api.AiRequests;
using PersonligFinans.Api.BankStatements;
using PersonligFinans.Api.CategorizationRules;
using PersonligFinans.Api.Receipts;

namespace PersonligFinans.Api.Tests;

// Every test class shares one database, and the global cap counts every User's AI requests made
// today. So each test here sets its clock to a day of its own in 2099, which no other test's clock
// reads: its "today" then holds only its own AI requests, whatever else has run. The days are in
// the future, not the past, because signing in runs on the same clock, and the test client would
// throw away a sign-in cookie that has expired by its own, real clock.
// Times are written in Norwegian time: CET in winter, CEST in summer.
[Collection(ApiCollection.Name)]
public class DailyAiLimitTests
{
    private static readonly TimeSpan Cet = TimeSpan.FromHours(1);
    private static readonly TimeSpan Cest = TimeSpan.FromHours(2);

    // Written out, not taken from the API's own ReceiptSuggestion.LimitReached, so that it says what
    // the answer must be rather than whatever the API answers.
    private static readonly ReceiptSuggestion LimitReached =
        new(ReceiptOutcome.LimitReached, null, null, null, null);

    private readonly PostgresApiFactory _factory;

    public DailyAiLimitTests(PostgresApiFactory factory)
    {
        _factory = factory;
    }

    // An API with the given limits, whose clock is the given one, asking the given fakes in place
    // of the LLM. Without a fake, that part of the LLM is unavailable.
    private WebApplicationFactory<Program> Api(
        FakeClock clock,
        int perUser,
        int allUsers,
        FakeRuleGenerator? ruleGenerator = null,
        FakeReceiptReader? receiptReader = null) =>
        _factory.WithWebHostBuilder(builder =>
        {
            const string section = DailyAiLimit.SectionName;
            builder.UseSetting($"{section}:{nameof(DailyAiLimit.PerUser)}", Invariant(perUser));
            builder.UseSetting($"{section}:{nameof(DailyAiLimit.AllUsers)}", Invariant(allUsers));
            builder.ConfigureTestServices(services =>
            {
                services.AddSingleton<TimeProvider>(clock);
                if (ruleGenerator is not null)
                    services.AddSingleton<IRuleGenerator>(ruleGenerator);
                if (receiptReader is not null)
                    services.AddSingleton<IReceiptReader>(receiptReader);
            });
        });

    // A clock at noon on the given day of January 2099.
    private static FakeClock NoonOnJanuary(int day) => new(new DateTimeOffset(2099, 1, day, 12, 0, 0, Cet));

    private static string Invariant(int number) => number.ToString(CultureInfo.InvariantCulture);

    // A reader that reads every Receipt, as a purchase at Kiwi.
    private static FakeReceiptReader ReaderReadingEveryReceipt() =>
        new() { Reading = new ReceiptReading.Read(new DateOnly(2026, 8, 3), "Kiwi", 100m, "NOK", false, null) };

    private static async Task<ReceiptSuggestion> ReadReceipt(HttpClient client)
    {
        var image = new ByteArrayContent([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, .."JFIF"u8, 0x00]);
        image.Headers.ContentType = new MediaTypeHeaderValue("image/jpeg");
        using var form = new MultipartFormDataContent { { image, "file", "kvittering.jpg" } };
        var response = await client.PostAsync("/api/receipts/read", form);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<ReceiptSuggestion>())!;
    }

    private static async Task<BankStatementResponse> Import(HttpClient client, byte[] pdf)
    {
        var file = new ByteArrayContent(pdf);
        file.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
        using var form = new MultipartFormDataContent { { file, "file", "kontoutskrift.pdf" } };
        var response = await client.PostAsync("/api/bank-statements", form);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<BankStatementResponse>())!;
    }

    [Fact]
    public async Task BankStatementsBeyondTheUsersLimit_AreImportedWithUnmatchedRowsUncategorized_SayingTheLimitIsReached()
    {
        var generator = new FakeRuleGenerator().Proposing("Kafé", "kafé", "Other");
        await using var api = Api(NoonOnJanuary(11), perUser: 1, allUsers: 100,
            ruleGenerator: generator);
        var client = await api.CreateSignedInClientAsync();

        var first = await Import(client, StatementPdf.WithPurchasesFrom("Kafé"));
        // Rema 1000 matches a seeded rule; Frisør matches none.
        var second = await Import(client, StatementPdf.WithPurchasesFrom("Rema 1000", "Frisør"));

        Assert.Single(generator.Calls);
        Assert.Equal((0, false), (first.UncategorizedCount, first.DailyAiLimitReached));
        Assert.Equal((2, 1), (second.TransactionCount, second.UncategorizedCount));
        Assert.True(second.DailyAiLimitReached);
        Assert.False(second.AiCategorizationUnavailable);
    }

    [Fact]
    public async Task ReceiptsBeyondTheUsersLimit_AreNotRead_AndAnswerLimitReachedWithEveryFieldNull()
    {
        var reader = ReaderReadingEveryReceipt();
        await using var api = Api(NoonOnJanuary(10), perUser: 2, allUsers: 100,
            receiptReader: reader);
        var client = await api.CreateSignedInClientAsync();

        var suggestions = new[] { await ReadReceipt(client), await ReadReceipt(client), await ReadReceipt(client) };

        Assert.Equal(
            [ReceiptOutcome.Read, ReceiptOutcome.Read, ReceiptOutcome.LimitReached],
            suggestions.Select(s => s.Outcome));
        Assert.Equal(LimitReached, suggestions[2]);
        Assert.Equal(2, reader.Calls.Count);
    }

    [Fact]
    public async Task ABankStatementWhoseRowsAllMatch_TakesNoAiRequest()
    {
        var generator = new FakeRuleGenerator();
        await using var api = Api(NoonOnJanuary(14), perUser: 1, allUsers: 100,
            ruleGenerator: generator, receiptReader: ReaderReadingEveryReceipt());
        var client = await api.CreateSignedInClientAsync();

        // Both match seeded rules.
        var imported = await Import(client, StatementPdf.WithPurchasesFrom("Rema 1000", "Kiwi"));
        var suggestion = await ReadReceipt(client);

        Assert.Empty(generator.Calls);
        Assert.False(imported.DailyAiLimitReached);
        Assert.Equal(ReceiptOutcome.Read, suggestion.Outcome);
    }

    [Fact]
    public async Task AiRequestsThatFail_StillCount()
    {
        var generator = new FakeRuleGenerator { Unavailable = true };
        var reader = new FakeReceiptReader();
        await using var api = Api(NoonOnJanuary(15), perUser: 2, allUsers: 100,
            ruleGenerator: generator, receiptReader: reader);
        var client = await api.CreateSignedInClientAsync();

        var unavailable = await Import(client, StatementPdf.WithPurchasesFrom("Kafé"));
        var unreadable = await ReadReceipt(client);
        var beyondTheLimit = await Import(client, StatementPdf.WithPurchasesFrom("Frisør"));

        Assert.True(unavailable.AiCategorizationUnavailable);
        Assert.Equal(ReceiptOutcome.Unreadable, unreadable.Outcome);
        Assert.True(beyondTheLimit.DailyAiLimitReached);
        Assert.Equal(LimitReached, await ReadReceipt(client));
        Assert.Single(generator.Calls);
        Assert.Single(reader.Calls);
    }

    [Fact]
    public async Task WithoutARuleGeneratorOrReceiptReader_NoAiRequestIsTaken()
    {
        var clock = NoonOnJanuary(16);
        var email = SignedInClient.UniqueEmail();
        await using (var withoutTheLlm = Api(clock, perUser: 1, allUsers: 100))
        {
            var client = await withoutTheLlm.CreateSignedInClientAsync(email);

            var imported = await Import(client, StatementPdf.WithPurchasesFrom("Kafé"));
            var suggestion = await ReadReceipt(client);

            Assert.Equal((false, false), (imported.AiCategorizationUnavailable, imported.DailyAiLimitReached));
            Assert.Equal(ReceiptOutcome.Unavailable, suggestion.Outcome);
        }

        await using var withAReader = Api(clock, perUser: 1, allUsers: 100,
            receiptReader: ReaderReadingEveryReceipt());
        var sameUser = await withAReader.CreateClientSignedInAsAsync(email);

        Assert.Equal(ReceiptOutcome.Read, (await ReadReceipt(sameUser)).Outcome);
    }

    // The first AI request of a day, just after midnight and before any change of the clocks; the
    // last moment of that day; and the midnight that starts the next.
    public static TheoryData<DateTimeOffset, DateTimeOffset, DateTimeOffset> Days => new()
    {
        // An ordinary day, in winter time.
        { new(2099, 1, 12, 0, 30, 0, Cet), new(2099, 1, 12, 23, 59, 59, Cet), new(2099, 1, 13, 0, 0, 0, Cet) },
        // The clocks go forward at 02:00, so the day starts in winter time and ends in summer time.
        { new(2099, 3, 29, 0, 30, 0, Cet), new(2099, 3, 29, 23, 59, 59, Cest), new(2099, 3, 30, 0, 0, 0, Cest) },
        // The clocks go back at 03:00, so the day starts in summer time and ends in winter time.
        { new(2099, 10, 25, 0, 30, 0, Cest), new(2099, 10, 25, 23, 59, 59, Cet), new(2099, 10, 26, 0, 0, 0, Cet) },
    };

    [Theory]
    [MemberData(nameof(Days))]
    public async Task TheLimit_IsReachedUntilMidnightInNorway(
        DateTimeOffset firstRequest, DateTimeOffset lastMomentOfTheDay, DateTimeOffset nextMidnight)
    {
        var clock = new FakeClock(firstRequest);
        await using var api = Api(clock, perUser: 1, allUsers: 100, receiptReader: ReaderReadingEveryReceipt());
        var client = await api.CreateSignedInClientAsync();

        var first = await ReadReceipt(client);
        clock.Now = lastMomentOfTheDay;
        var stillThatDay = await ReadReceipt(client);
        clock.Now = nextMidnight;
        var nextDay = await ReadReceipt(client);

        Assert.Equal(
            [ReceiptOutcome.Read, ReceiptOutcome.LimitReached, ReceiptOutcome.Read],
            [first.Outcome, stillThatDay.Outcome, nextDay.Outcome]);
    }

    [Fact]
    public async Task OneUsersAiRequests_DoNotCountAgainstAnothersLimit()
    {
        await using var api = Api(NoonOnJanuary(17), perUser: 1, allUsers: 100,
            receiptReader: ReaderReadingEveryReceipt());
        var a = await api.CreateSignedInClientAsync();
        var b = await api.CreateSignedInClientAsync();

        await ReadReceipt(a);

        Assert.Equal(ReceiptOutcome.LimitReached, (await ReadReceipt(a)).Outcome);
        Assert.Equal(ReceiptOutcome.Read, (await ReadReceipt(b)).Outcome);
    }

    [Fact]
    public async Task TheCapOnAllUsersTogether_StopsEveryUser()
    {
        var generator = new FakeRuleGenerator();
        var reader = ReaderReadingEveryReceipt();
        await using var api = Api(NoonOnJanuary(18), perUser: 5, allUsers: 2,
            ruleGenerator: generator, receiptReader: reader);
        var a = await api.CreateSignedInClientAsync();
        var b = await api.CreateSignedInClientAsync();
        var c = await api.CreateSignedInClientAsync();

        await ReadReceipt(a);
        await ReadReceipt(b);

        Assert.Equal(LimitReached, await ReadReceipt(a));
        Assert.Equal(LimitReached, await ReadReceipt(c));
        Assert.True((await Import(c, StatementPdf.WithPurchasesFrom("Kafé"))).DailyAiLimitReached);
        Assert.Equal(2, reader.Calls.Count);
        Assert.Empty(generator.Calls);
    }

    [Fact]
    public async Task ConcurrentAiRequests_CannotTakeMoreThanTheLimit()
    {
        var reader = ReaderReadingEveryReceipt();
        await using var api = Api(NoonOnJanuary(19), perUser: 3, allUsers: 100, receiptReader: reader);
        var client = await api.CreateSignedInClientAsync();

        var suggestions = await Task.WhenAll(Enumerable.Range(0, 10).Select(_ => ReadReceipt(client)));

        Assert.Equal(3, suggestions.Count(s => s.Outcome == ReceiptOutcome.Read));
        Assert.Equal(3, reader.Calls.Count);
    }
}
