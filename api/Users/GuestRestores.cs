using Microsoft.Extensions.Options;
using PersonligFinans.Api.Data;

namespace PersonligFinans.Api.Users;

// When the Guest was last Restored, so that continuing as the Guest Restores it at most once every
// cooldown. Anyone can continue as the Guest, and a Restore holds the rule-change lock, which every
// User's rule changes wait for, so an unlimited Restore would let one visitor stall the app for
// everyone. Kept in memory: the app Restores the Guest whenever it starts, so a restart loses
// nothing.
public sealed class GuestRestores(TimeProvider clock, IOptions<GuestRestore> options)
{
    // One Restore at a time, so visitors continuing together cause one Restore rather than several.
    private readonly SemaphoreSlim _restoring = new(1, 1);

    private DateTimeOffset? _lastRestoredAt;

    // Restores the Guest that the context acts as, whenever it was last Restored.
    public async Task RestoreAsync(AppDbContext db)
    {
        await _restoring.WaitAsync();
        try
        {
            await GuestSnapshot.RestoreAsync(db);
            _lastRestoredAt = clock.GetUtcNow();
        }
        finally
        {
            _restoring.Release();
        }
    }

    // Restores the Guest that the context acts as, unless it was Restored within the cooldown.
    public async Task RestoreIfDueAsync(AppDbContext db)
    {
        await _restoring.WaitAsync();
        try
        {
            var cooldown = TimeSpan.FromMinutes(options.Value.CooldownMinutes);
            if (_lastRestoredAt is { } last && clock.GetUtcNow() - last < cooldown)
                return;
            await GuestSnapshot.RestoreAsync(db);
            _lastRestoredAt = clock.GetUtcNow();
        }
        finally
        {
            _restoring.Release();
        }
    }
}

public static class GuestRestoresSetup
{
    // Registers when the Guest was last Restored, with the cooldown from configuration, which may be
    // left out to keep its default.
    public static IServiceCollection AddGuestRestores(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddOptions<GuestRestore>()
            .Bind(configuration.GetSection(GuestRestore.SectionName))
            .Validate(
                restore => restore.CooldownMinutes >= 0,
                $"'{GuestRestore.SectionName}:{nameof(GuestRestore.CooldownMinutes)}' must not be negative.")
            .ValidateOnStart();
        return services.AddSingleton<GuestRestores>();
    }
}
