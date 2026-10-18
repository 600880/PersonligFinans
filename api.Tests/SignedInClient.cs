using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace PersonligFinans.Api.Tests;

public static class SignedInClient
{
    public const string Password = "correct horse battery staple";

    // An email no other test registers.
    public static string UniqueEmail() => $"user-{Guid.NewGuid():N}@example.com";

    // Registers a fresh User through the register endpoint and returns a client signed in as it,
    // whose cookie container keeps the sign-in cookie. Works on the shared factory and on any made
    // from it with WithWebHostBuilder.
    public static async Task<HttpClient> CreateSignedInClientAsync(this WebApplicationFactory<Program> factory)
    {
        var client = factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/user/register", new { email = UniqueEmail(), password = Password });
        response.EnsureSuccessStatusCode();
        return client;
    }
}
