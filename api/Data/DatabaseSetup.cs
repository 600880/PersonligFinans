using Microsoft.EntityFrameworkCore;
using PersonligFinans.Api.CategorizationRules;

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
        var hadPendingMigrations = (await db.Database.GetPendingMigrationsAsync()).Any();
        await db.Database.MigrateAsync();

        // A migration may change the rules, for example by seeding them, so re-match the imported
        // Transactions already stored to keep them in line with the rules.
        if (hadPendingMigrations)
            await Categorizer.SaveRuleChangeAsync(db);
    }
}
