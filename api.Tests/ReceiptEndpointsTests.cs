using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PersonligFinans.Api.Data;

namespace PersonligFinans.Api.Tests;

[Collection(ApiCollection.Name)]
public class ReceiptEndpointsTests
{
    private readonly PostgresApiFactory _factory;
    private readonly HttpClient _client;

    public ReceiptEndpointsTests(PostgresApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    // The leading bytes of each accepted image type, followed by a little filler. The endpoint only
    // looks at how a file starts, so these stand in for real photos of Receipts.
    private static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, .."JFIF"u8, 0x00];
    private static readonly byte[] Png = [0x89, .."PNG"u8, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D];
    private static readonly byte[] WebP = [.."RIFF"u8, 0x24, 0x00, 0x00, 0x00, .."WEBPVP8 "u8];
    private static readonly byte[] Gif = [.."GIF89a"u8, 0x01, 0x00, 0x01, 0x00];

    private async Task<HttpResponseMessage> Read(byte[] content, string fileName, string contentType)
    {
        var file = new ByteArrayContent(content);
        file.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        using var form = new MultipartFormDataContent { { file, "file", fileName } };
        return await _client.PostAsync("/api/receipts/read", form);
    }

    private static async Task<string[]> FileErrors(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        return problem!.Errors["file"];
    }

    private async Task<(int Transactions, int Rules)> Stored()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return (await db.Transactions.CountAsync(), await db.CategorizationRules.CountAsync());
    }

    public static TheoryData<string, string> Images => new()
    {
        { "jpeg", "image/jpeg" },
        { "png", "image/png" },
        { "webp", "image/webp" },
        { "gif", "image/gif" },
    };

    private static byte[] ImageOfType(string type) => type switch
    {
        "jpeg" => Jpeg,
        "png" => Png,
        "webp" => WebP,
        _ => Gif,
    };

    [Theory]
    [MemberData(nameof(Images))]
    public async Task Post_Image_WithoutAReceiptReader_AnswersUnavailableWithEveryFieldNull(string type, string contentType)
    {
        var response = await Read(ImageOfType(type), $"kvittering.{type}", contentType);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var suggestion = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(
            """{"outcome":"unavailable","date":null,"description":null,"amount":null,"categoryId":null}""",
            suggestion.RootElement.GetRawText());
    }

    [Fact]
    public async Task Post_ImageDeclaredAsAnotherType_IsReadByItsBytes()
    {
        var response = await Read(Png, "kvittering.jpg", "application/octet-stream");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Post_Image_LeavesTransactionsAndCategorizationRulesUnchanged()
    {
        var before = await Stored();

        var response = await Read(Jpeg, "kvittering.jpg", "image/jpeg");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(before, await Stored());
    }

    [Fact]
    public async Task Post_FileThatIsNotAnImage_IsRejected()
    {
        var response = await Read("%PDF-1.7\n"u8.ToArray(), "kvittering.pdf", "application/pdf");

        Assert.Equal(["The file is not a JPEG, PNG, WebP or GIF image."], await FileErrors(response));
    }

    [Fact]
    public async Task Post_FileDeclaredAsAnImageWhoseBytesAreNot_IsRejected()
    {
        var response = await Read("not really a photo"u8.ToArray(), "kvittering.jpg", "image/jpeg");

        Assert.Equal(["The file is not a JPEG, PNG, WebP or GIF image."], await FileErrors(response));
    }

    [Fact]
    public async Task Post_FileShorterThanAnyImageHeader_IsRejected()
    {
        var response = await Read([0xFF, 0xD8], "kvittering.jpg", "image/jpeg");

        Assert.Equal(["The file is not a JPEG, PNG, WebP or GIF image."], await FileErrors(response));
    }

    [Fact]
    public async Task Post_FileOverTenMegabytes_IsRejected()
    {
        var tooLarge = new byte[10 * 1024 * 1024 + 1];
        Jpeg.CopyTo(tooLarge, 0);

        var response = await Read(tooLarge, "kvittering.jpg", "image/jpeg");

        Assert.Equal(["The file is larger than 10 MB."], await FileErrors(response));
    }

    [Fact]
    public async Task Post_WithoutAFile_IsRejected()
    {
        using var form = new MultipartFormDataContent { { new StringContent("hello"), "note" } };

        var response = await _client.PostAsync("/api/receipts/read", form);

        Assert.Equal(["Choose a Receipt image to read."], await FileErrors(response));
    }

    [Fact]
    public async Task Post_WithoutAForm_IsRejected()
    {
        var response = await _client.PostAsJsonAsync("/api/receipts/read", new { file = "kvittering.jpg" });

        Assert.Equal(["Choose a Receipt image to read."], await FileErrors(response));
    }
}
