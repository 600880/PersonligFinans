using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using PersonligFinans.Api.Data;

namespace PersonligFinans.Api.Users;

// Records every reset email the app tries to send, and keeps them within the caps on reset emails:
// no more than one to a User within the per-address window, and no more than the daily cap from the
// whole app since the latest midnight in Norway. Now is read from the injected clock.
public sealed class PasswordResetEmailLedger(
    AppDbContext db, TimeProvider clock, IOptions<PasswordResetLimit> limit, ILogger<PasswordResetEmailLedger> logger)
{
    // Takes one reset email to the User, to be sent right after: records it and answers true, or
    // answers false and records nothing when a cap is reached. It is recorded before it is sent, so
    // one that fails to send still counts. Opens and commits a database transaction of its own, so
    // call it outside any other. It leaves the database context's tracked changes alone.
    public async Task<bool> TryTakeAsync(string userId)
    {
        var now = clock.GetUtcNow();
        var windowStart = now.AddMinutes(-limit.Value.PerAddressMinutes);
        var (dayStart, dayEnd) = NorwegianDay.Around(now);

        // Counts and records under a lock that conflicts with itself, so concurrent requests take
        // turns and can't both take the one email a User may be sent. The lock is held only this
        // long, never while the email is sent.
        await using var transaction = await db.Database.BeginTransactionAsync();
        await db.Database.ExecuteSqlRawAsync("LOCK TABLE sent_password_reset_emails IN SHARE ROW EXCLUSIVE MODE");
        if (await db.SentPasswordResetEmails.CountAsync(e => e.SentAt >= dayStart && e.SentAt < dayEnd) >= limit.Value.PerDay)
        {
            logger.LogWarning(
                "The app has sent the daily cap of {Cap} reset emails, so no other is sent today.", limit.Value.PerDay);
            return false;
        }
        if (await db.SentPasswordResetEmails.AnyAsync(e => e.UserId == userId && e.SentAt > windowStart))
        {
            logger.LogInformation(
                "A User was sent a reset email within the last {Minutes} minutes, so no other is sent.",
                limit.Value.PerAddressMinutes);
            return false;
        }

        await db.Database.ExecuteSqlAsync(
            $"INSERT INTO sent_password_reset_emails (user_id, sent_at) VALUES ({userId}, {now})");
        // Keeps the table to the emails a cap still counts: those sent today, or within the window,
        // which may reach back past midnight. So nothing is kept for much over a day, and nothing
        // needs clearing out on a schedule of its own.
        await db.SentPasswordResetEmails
            .Where(e => e.SentAt < dayStart && e.SentAt <= windowStart)
            .ExecuteDeleteAsync();
        await transaction.CommitAsync();
        return true;
    }
}

public static class PasswordResetEmailLedgerSetup
{
    // Registers the ledger with the caps on reset emails from configuration, which may leave out
    // either cap to keep its default.
    public static IServiceCollection AddPasswordResetEmailLedger(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddOptions<PasswordResetLimit>()
            .Bind(configuration.GetSection(PasswordResetLimit.SectionName))
            .Validate(
                limit => limit.PerAddressMinutes >= 0 && limit.PerDay >= 0,
                $"'{PasswordResetLimit.SectionName}:{nameof(PasswordResetLimit.PerAddressMinutes)}' and " +
                $"'{PasswordResetLimit.SectionName}:{nameof(PasswordResetLimit.PerDay)}' must not be negative.")
            .ValidateOnStart();
        return services.AddScoped<PasswordResetEmailLedger>();
    }
}
