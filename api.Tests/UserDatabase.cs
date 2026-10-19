using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using PersonligFinans.Api.Data;
using PersonligFinans.Api.Users;

namespace PersonligFinans.Api.Tests;

// A database context that acts as one User, as the endpoints' does for a request signed in as them:
// it sees only that User's rows, and OwnerOfNewRows is the owner to give the rows a test adds.
public sealed class UserDatabase : IAsyncDisposable
{
    private readonly AsyncServiceScope _scope;

    private UserDatabase(AsyncServiceScope scope)
    {
        _scope = scope;
        Db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    }

    public AppDbContext Db { get; }

    // Acts as the User registered with the given email.
    public static async Task<UserDatabase> OfAsync(WebApplicationFactory<Program> factory, string email)
    {
        var scope = factory.Services.CreateAsyncScope();
        var user = await scope.ServiceProvider.GetRequiredService<UserManager<IdentityUser>>().FindByEmailAsync(email)
            ?? throw new InvalidOperationException($"No User is registered with {email}.");
        scope.ServiceProvider.GetRequiredService<CurrentUser>().ActAs(user.Id);
        return new UserDatabase(scope);
    }

    public ValueTask DisposeAsync() => _scope.DisposeAsync();
}
