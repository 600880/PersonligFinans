using Microsoft.EntityFrameworkCore;

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

    public static void MigrateDatabase(this WebApplication app)
    {
        using var scope = app.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.Migrate();
    }
}
