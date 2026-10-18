using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using PersonligFinans.Api.AiRequests;
using PersonligFinans.Api.CategorizationRules;
using PersonligFinans.Api.Data;
using Testcontainers.PostgreSql;

namespace PersonligFinans.Api.Tests;

// Runs the API against a throwaway Postgres container, never the developer's database.
public class PostgresApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:17-alpine").Build();

    // The sign-in cookie is Secure, so the test clients' cookie containers only send it back over
    // HTTPS. Factories made with WithWebHostBuilder copy these options.
    public PostgresApiFactory()
    {
        ClientOptions.BaseAddress = new Uri("https://localhost");
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");
        builder.UseSetting(
            $"ConnectionStrings:{DatabaseSetup.ConnectionStringName}",
            _postgres.GetConnectionString());
        // Never Azure, even when the developer has configured the rule generator and receipt reader
        // in user secrets.
        builder.UseSetting($"{RuleGeneratorSetup.SectionName}:Endpoint", "");
        // Every test asking the fake LLM on the real clock counts towards the same day's cap on all
        // Users, in the one database they share. A run makes some 60 AI requests, well under the
        // default 300, but limits far beyond any run keep these tests from ever depending on how
        // many there are. The Daily AI limit's own tests set small limits and a clock of their own.
        builder.UseSetting($"{DailyAiLimit.SectionName}:{nameof(DailyAiLimit.PerUser)}", "1000000");
        builder.UseSetting($"{DailyAiLimit.SectionName}:{nameof(DailyAiLimit.AllUsers)}", "1000000");
    }

    public Task InitializeAsync() => _postgres.StartAsync();

    Task IAsyncLifetime.DisposeAsync() => _postgres.DisposeAsync().AsTask();
}

[CollectionDefinition(Name)]
public class ApiCollection : ICollectionFixture<PostgresApiFactory>
{
    public const string Name = "API";
}
