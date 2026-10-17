using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using PersonligFinans.Api.CategorizationRules;
using PersonligFinans.Api.Data;
using Testcontainers.PostgreSql;

namespace PersonligFinans.Api.Tests;

// Runs the API against a throwaway Postgres container, never the developer's database.
public class PostgresApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:17-alpine").Build();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");
        builder.UseSetting(
            $"ConnectionStrings:{DatabaseSetup.ConnectionStringName}",
            _postgres.GetConnectionString());
        // Never Azure, even when the developer has configured the rule generator and receipt reader
        // in user secrets.
        builder.UseSetting($"{RuleGeneratorSetup.SectionName}:Endpoint", "");
    }

    public Task InitializeAsync() => _postgres.StartAsync();

    Task IAsyncLifetime.DisposeAsync() => _postgres.DisposeAsync().AsTask();
}

[CollectionDefinition(Name)]
public class ApiCollection : ICollectionFixture<PostgresApiFactory>
{
    public const string Name = "API";
}
