using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using PersonligFinans.Api.Users;

namespace PersonligFinans.Api.Tests;

public static class SignedInClient
{
    public const string Password = "correct horse battery staple";

    // An email no other test registers.
    public static string UniqueEmail() => $"user-{Guid.NewGuid():N}@example.com";

    // Registers a fresh User, with the given email or one no other test registers, through the
    // register endpoint and returns a client signed in as it, whose cookie container keeps the sign-in
    // cookie. Like the web app, the client then fetches an antiforgery token and sends it with every
    // request, so the multipart forms accept it. Works on the shared factory and on any made from it
    // with WithWebHostBuilder.
    public static async Task<HttpClient> CreateSignedInClientAsync(
        this WebApplicationFactory<Program> factory, string? email = null)
    {
        var client = factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/user/register", new { email = email ?? UniqueEmail(), password = Password });
        response.EnsureSuccessStatusCode();
        await SendAntiforgeryTokenAsync(client);
        return client;
    }

    // Returns a client signed in as a User already registered with the given email, by logging in,
    // with an antiforgery token as above. A factory made with WithWebHostBuilder signs its clients in
    // on its own, so this is how its client acts for the same User as one of the shared factory's.
    public static async Task<HttpClient> CreateClientSignedInAsAsync(this WebApplicationFactory<Program> factory, string email)
    {
        var client = factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/user/log-in", new { email, password = Password });
        response.EnsureSuccessStatusCode();
        await SendAntiforgeryTokenAsync(client);
        return client;
    }

    private static async Task SendAntiforgeryTokenAsync(HttpClient client)
    {
        var token = (await client.GetFromJsonAsync<AntiforgeryTokenResponse>("/api/antiforgery-token"))!.Token;
        client.DefaultRequestHeaders.Add(AntiforgerySetup.HeaderName, token);
    }
}
