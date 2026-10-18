using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using PersonligFinans.Api.Data;

namespace PersonligFinans.Api.AiRequests;

// Records every AI request, and keeps them within the Daily AI limit: since the latest midnight in
// Norway, no more than the per-User limit by any one User, and no more than the global cap by all
// Users together. Today is read from the injected clock.
public sealed class AiRequestLedger(
    AppDbContext db, TimeProvider clock, IOptions<DailyAiLimit> limit, ILogger<AiRequestLedger> logger)
{
    private static readonly TimeZoneInfo Norway = TimeZoneInfo.FindSystemTimeZoneById("Europe/Oslo");

    // Takes one AI request for the current User, to be made right after: records it and answers
    // true, or answers false and records nothing when the User or all Users together have reached
    // their limit today. It is recorded before the LLM is asked, so one that fails still counts.
    // Opens and commits a database transaction of its own, so call it outside any other. It leaves
    // the database context's tracked changes alone.
    public async Task<bool> TryTakeAsync()
    {
        var userId = db.CurrentUserId
            ?? throw new InvalidOperationException("Only a signed-in User can make an AI request.");
        var now = clock.GetUtcNow();
        var (start, end) = DayAround(now);

        // Counts and records under a lock that conflicts with itself, so concurrent requests take
        // turns and can't both take the last AI request left. The lock is held only this long, never
        // while the LLM is asked.
        await using var transaction = await db.Database.BeginTransactionAsync();
        await db.Database.ExecuteSqlRawAsync("LOCK TABLE ai_requests IN SHARE ROW EXCLUSIVE MODE");
        var today = db.AiRequests.Where(r => r.MadeAt >= start && r.MadeAt < end);
        if (await today.CountAsync() >= limit.Value.AllUsers)
        {
            logger.LogWarning(
                "All Users together have made the daily cap of {Cap} AI requests.", limit.Value.AllUsers);
            return false;
        }
        if (await today.CountAsync(r => r.UserId == userId) >= limit.Value.PerUser)
        {
            logger.LogInformation(
                "A User has made the Daily AI limit of {Limit} AI requests.", limit.Value.PerUser);
            return false;
        }

        await db.Database.ExecuteSqlAsync($"INSERT INTO ai_requests (user_id, made_at) VALUES ({userId}, {now})");
        await transaction.CommitAsync();
        return true;
    }

    // The day in Norway that the instant falls on, from the midnight that starts it to the one that
    // ends it. Bounded at both ends, so it holds only that day's AI requests whatever else is stored.
    private static (DateTimeOffset Start, DateTimeOffset End) DayAround(DateTimeOffset instant)
    {
        var date = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(instant, Norway).DateTime);
        return (Midnight(date), Midnight(date.AddDays(1)));
    }

    // The instant the date starts in Norway, in UTC as Postgres stores it. Its UTC offset, an hour in
    // winter and two in summer, is the one in force at that midnight. Norway changes its clocks at
    // 02:00 or 03:00, never at midnight, so midnight always exists and happens once.
    private static DateTimeOffset Midnight(DateOnly date)
    {
        var midnight = date.ToDateTime(TimeOnly.MinValue);
        return new DateTimeOffset(midnight, Norway.GetUtcOffset(midnight)).ToUniversalTime();
    }
}

public static class AiRequestLedgerSetup
{
    // Registers the ledger with the Daily AI limit from configuration, which may leave out either
    // limit to keep its default.
    public static IServiceCollection AddAiRequestLedger(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddOptions<DailyAiLimit>()
            .Bind(configuration.GetSection(DailyAiLimit.SectionName))
            .Validate(
                limit => limit.PerUser >= 0 && limit.AllUsers >= 0,
                $"'{DailyAiLimit.SectionName}:{nameof(DailyAiLimit.PerUser)}' and " +
                $"'{DailyAiLimit.SectionName}:{nameof(DailyAiLimit.AllUsers)}' must not be negative.")
            .ValidateOnStart();
        return services.AddScoped<AiRequestLedger>();
    }
}
