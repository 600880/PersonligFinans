using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using PersonligFinans.Api.Users;

namespace PersonligFinans.Api.Tests;

[Collection(ApiCollection.Name)]
public class AntiforgeryTests
{
    private readonly PostgresApiFactory _factory;

    public AntiforgeryTests(PostgresApiFactory factory)
    {
        _factory = factory;
    }

    // The two multipart forms, each with a file its endpoint accepts: a one-row Bank Statement to
    // upload, and a JPEG Receipt to read, answered Unavailable since the tests configure no receipt
    // reader.
    public static TheoryData<string> Forms => ["bank statement", "receipt"];

    private static async Task<HttpResponseMessage> PostForm(HttpClient client, string form)
    {
        if (form == "bank statement")
        {
            var digits = Random.Shared.NextInt64(0, 100_000_000_000).ToString("D11");
            var pdf = StatementPdf.Create(
                accountNumber: $"{digits[..4]}.{digits[4..6]}.{digits[6..]}",
                period: "01.08.2026 - 31.08.2026",
                openingBalance: "1.000,00",
                rows: [new("Varer 28.08 Matbutikk Sentrum", "2908", "10,00", null, "2908", "21", "12345678")],
                closingBalance: "990,00");
            return await Post(client, "/api/bank-statements", pdf, "application/pdf", "kontoutskrift.pdf");
        }

        byte[] jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, .."JFIF"u8, 0x00];
        return await Post(client, "/api/receipts/read", jpeg, "image/jpeg", "kvittering.jpg");
    }

    private static async Task<HttpResponseMessage> Post(
        HttpClient client, string url, byte[] content, string contentType, string fileName)
    {
        var file = new ByteArrayContent(content);
        file.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        using var form = new MultipartFormDataContent { { file, "file", fileName } };
        return await client.PostAsync(url, form);
    }

    private static void UseToken(HttpClient client, string? token)
    {
        client.DefaultRequestHeaders.Remove(AntiforgerySetup.HeaderName);
        if (token is not null)
            client.DefaultRequestHeaders.Add(AntiforgerySetup.HeaderName, token);
    }

    private static async Task<string> TokenFor(HttpClient client)
    {
        var response = await client.GetAsync("/api/antiforgery-token");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<AntiforgeryTokenResponse>())!.Token;
    }

    [Theory]
    [MemberData(nameof(Forms))]
    public async Task Form_WithTheSignedInUsersToken_IsAccepted(string form)
    {
        var client = await _factory.CreateSignedInClientAsync();
        UseToken(client, await TokenFor(client));

        var response = await PostForm(client, form);

        Assert.True(response.IsSuccessStatusCode, $"Expected success, got {response.StatusCode}.");
    }

    [Theory]
    [MemberData(nameof(Forms))]
    public async Task Form_WithoutAToken_IsRefused(string form)
    {
        var client = await _factory.CreateSignedInClientAsync();
        UseToken(client, null);

        var response = await PostForm(client, form);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Theory]
    [MemberData(nameof(Forms))]
    public async Task Form_WithAMalformedToken_IsRefused(string form)
    {
        var client = await _factory.CreateSignedInClientAsync();
        UseToken(client, "not-a-token");

        var response = await PostForm(client, form);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Theory]
    [MemberData(nameof(Forms))]
    public async Task Form_WithAnotherUsersToken_IsRefused(string form)
    {
        var client = await _factory.CreateSignedInClientAsync();
        var other = await _factory.CreateSignedInClientAsync();
        UseToken(client, await TokenFor(other));

        var response = await PostForm(client, form);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    // A token is bound to whoever was signed in when it was given, so the client fetches one after
    // signing in.
    [Theory]
    [MemberData(nameof(Forms))]
    public async Task Form_WithATokenGivenBeforeSigningIn_IsRefused(string form)
    {
        var client = _factory.CreateClient();
        var token = await TokenFor(client);
        var signedUp = await client.PostAsJsonAsync(
            "/api/user/sign-up", new { email = SignedInClient.UniqueEmail(), password = SignedInClient.Password });
        Assert.Equal(HttpStatusCode.OK, signedUp.StatusCode);
        UseToken(client, token);

        var response = await PostForm(client, form);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Form_SignedOut_Returns401_EvenWithoutAToken()
    {
        var client = _factory.CreateClient();

        var response = await PostForm(client, "bank statement");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Token_SignedOut_IsGiven()
    {
        var client = _factory.CreateClient();

        Assert.NotEmpty(await TokenFor(client));
    }

    // The JSON endpoints rely on SameSite cookies and the JSON content type instead.
    [Fact]
    public async Task JsonEndpoint_WithoutAToken_IsAccepted()
    {
        var client = await _factory.CreateSignedInClientAsync();
        UseToken(client, null);

        var response = await client.PostAsJsonAsync("/api/categories", new { name = $"Hobbies {Guid.NewGuid():N}", description = "Hobbies." });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }
}
