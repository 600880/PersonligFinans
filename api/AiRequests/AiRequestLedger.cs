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
        var (start, end) = NorwegianDay.Around(now);

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
