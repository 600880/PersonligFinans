using Microsoft.EntityFrameworkCore;
using PersonligFinans.Api.CategorizationRules;
using PersonligFinans.Api.Users;

namespace PersonligFinans.Api.Data;

public static class DatabaseSetup
{
    public const string ConnectionStringName = "PersonligFinans";

    public static void Configure(DbContextOptionsBuilder options, string connectionString) =>
        options.UseNpgsql(connectionString).UseSnakeCaseNamingConvention();

    public static IServiceCollection AddDatabase(this IServiceCollection services, IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString(ConnectionStringName);
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException(
                $"Connection string '{ConnectionStringName}' is not set. From the repo root, run:\n" +
                $"  dotnet user-secrets set \"ConnectionStrings:{ConnectionStringName}\" " +
                "\"Host=localhost;Port=5432;Database=personligfinans;Username=<user>;Password=<password>\" --project api");
        }

        return services.AddDbContext<AppDbContext>(options => Configure(options, connectionString));
    }

    public static async Task MigrateDatabaseAsync(this WebApplication app)
    {
        using var scope = app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Database.MigrateAsync();

        // So the Guest exists on a fresh deployment, without anyone registering it.
        await Guest.CreateIfMissingAsync(app.Services);

        // A migration may change the rules, whether applied here or by hand. Re-matching is
        // idempotent and cheap, so do it on every startup to keep the imported Transactions already
        // stored in line with the rules: each User's against that User's own rules, as that User.
        // Only Users with imported Transactions have any to re-match.
        var userIds = await db.Transactions
            .IgnoreQueryFilters()
            .Where(t => t.BankStatementId != null)
            .Select(t => t.UserId)
            .Distinct()
            .ToListAsync();
        foreach (var userId in userIds)
        {
            using var userScope = app.Services.CreateScope();
            userScope.ServiceProvider.GetRequiredService<CurrentUser>().ActAs(userId);
            await Categorizer.SaveRuleChangeAsync(userScope.ServiceProvider.GetRequiredService<AppDbContext>());
        }
    }
}
