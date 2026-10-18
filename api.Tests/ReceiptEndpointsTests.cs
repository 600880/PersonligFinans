using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PersonligFinans.Api.CategorizationRules;
using PersonligFinans.Api.Data;
using PersonligFinans.Api.Receipts;

namespace PersonligFinans.Api.Tests;

[Collection(ApiCollection.Name)]
public class ReceiptEndpointsTests : IAsyncLifetime
{
    private readonly PostgresApiFactory _factory;
    private readonly string _email = SignedInClient.UniqueEmail();
    private HttpClient _client = null!;
    private SeededCategories _seeded = null!;

    public ReceiptEndpointsTests(PostgresApiFactory factory)
    {
        _factory = factory;
    }

    public async Task InitializeAsync()
    {
        _client = await _factory.CreateSignedInClientAsync(_email);
        _seeded = await SeededCategories.Of(_client);
    }

    public Task DisposeAsync() => Task.CompletedTask;

    // The leading bytes of each accepted image type, followed by a little filler. The endpoint only
    // looks at how a file starts, so these stand in for real photos of Receipts.
    private static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, .."JFIF"u8, 0x00];
    private static readonly byte[] Png = [0x89, .."PNG"u8, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D];
    private static readonly byte[] WebP = [.."RIFF"u8, 0x24, 0x00, 0x00, 0x00, .."WEBPVP8 "u8];
    private static readonly byte[] Gif = [.."GIF89a"u8, 0x01, 0x00, 0x01, 0x00];

    // Sends a Receipt to the API as configured by default, with no receipt reader.
    private Task<HttpResponseMessage> Read(byte[] content, string fileName, string contentType) =>
        Read(content, fileName, contentType, _client);

    // Sends a Receipt to an API that has the given receipt reader.
    private async Task<HttpResponseMessage> Read(
        byte[] content, string fileName, string contentType, IReceiptReader receiptReader)
    {
        await using var api = _factory.WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services => services.AddSingleton(receiptReader)));
        using var client = await api.CreateClientSignedInAsAsync(_email);
        return await Read(content, fileName, contentType, client);
    }

    private static async Task<HttpResponseMessage> Read(byte[] content, string fileName, string contentType, HttpClient client)
    {
        var file = new ByteArrayContent(content);
        file.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        using var form = new MultipartFormDataContent { { file, "file", fileName } };
        return await client.PostAsync("/api/receipts/read", form);
    }

    // Reads a JPEG Receipt with an API that has the given receipt reader, and returns its suggestion.
    private async Task<ReceiptSuggestion> SuggestionFrom(IReceiptReader receiptReader)
    {
        var response = await Read(Jpeg, "kvittering.jpg", "image/jpeg", receiptReader);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<ReceiptSuggestion>())!;
    }

    // A reader that reads every Receipt as a purchase with these details.
    private static FakeReceiptReader ReaderReading(
        DateOnly? purchaseDate = null,
        string? merchantName = null,
        decimal? total = null,
        string? currencyCode = "NOK",
        bool isRefund = false,
        string? categoryName = null) =>
        new() { Reading = new ReceiptReading.Read(purchaseDate, merchantName, total, currencyCode, isRefund, categoryName) };

    private async Task AddRule(string keyword, int categoryId)
    {
        var response = await _client.PostAsJsonAsync("/api/categorization-rules", new { keyword, categoryId });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    private static async Task<string[]> FileErrors(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        return problem!.Errors["file"];
    }

    private async Task<(int Transactions, int Rules)> Stored()
    {
        await using var user = await UserDatabase.OfAsync(_factory, _email);
        var db = user.Db;
        return (await db.Transactions.CountAsync(), await db.CategorizationRules.CountAsync());
    }

    public static TheoryData<byte[], string, string> Images => new()
    {
        { Jpeg, "kvittering.jpg", "image/jpeg" },
        { Png, "kvittering.png", "image/png" },
        { WebP, "kvittering.webp", "image/webp" },
        { Gif, "kvittering.gif", "image/gif" },
    };

    [Theory]
    [MemberData(nameof(Images))]
    public async Task Post_Image_WithoutAReceiptReader_AnswersUnavailableWithEveryFieldNull(
        byte[] image, string fileName, string contentType)
    {
        var response = await Read(image, fileName, contentType);

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

        Assert.Equal(["Choose a Receipt to read."], await FileErrors(response));
    }

    [Fact]
    public async Task Post_WithoutAForm_IsRejected()
    {
        var response = await _client.PostAsJsonAsync("/api/receipts/read", new { file = "kvittering.jpg" });

        Assert.Equal(["Choose a Receipt to read."], await FileErrors(response));
    }

    [Fact]
    public async Task Post_ReadReceipt_SuggestsItsDateDescriptionAndAmountWithTheCategoryOfAMatchingRule()
    {
        await AddRule("kafé", _seeded.Restaurants);

        var suggestion = await SuggestionFrom(ReaderReading(
            purchaseDate: new DateOnly(2026, 10, 12),
            merchantName: "Kafé Sentrum",
            total: 249.90m,
            categoryName: "Groceries"));

        Assert.Equal(
            new ReceiptSuggestion(ReceiptOutcome.Read, new DateOnly(2026, 10, 12), "Kafé Sentrum", -249.90m, _seeded.Restaurants),
            suggestion);
    }

    [Fact]
    public async Task Post_ReadReceiptNoRuleMatches_SuggestsTheReadersCategory()
    {
        var suggestion = await SuggestionFrom(ReaderReading(merchantName: "Torghandel", total: 89m, categoryName: "Groceries"));

        Assert.Equal(_seeded.Groceries, suggestion.CategoryId);
    }

    [Fact]
    public async Task Post_ReadReceiptNoRuleMatches_FindsTheReadersCategoryIgnoringCase()
    {
        var suggestion = await SuggestionFrom(ReaderReading(merchantName: "Torghandel", total: 89m, categoryName: "groceries"));

        Assert.Equal(_seeded.Groceries, suggestion.CategoryId);
    }

    [Fact]
    public async Task Post_ReadReceiptWithAnUnknownCategory_SuggestsNoCategory()
    {
        var suggestion = await SuggestionFrom(ReaderReading(merchantName: "Torghandel", total: 89m, categoryName: "Groceries and more"));

        Assert.Null(suggestion.CategoryId);
    }

    [Fact]
    public async Task Post_ReadReceiptWithoutAMerchantName_SuggestsTheReadersCategory()
    {
        var suggestion = await SuggestionFrom(ReaderReading(total: 89m, categoryName: "Groceries"));

        Assert.Null(suggestion.Description);
        Assert.Equal(_seeded.Groceries, suggestion.CategoryId);
    }

    [Fact]
    public async Task Post_ReadRefundReceipt_SuggestsAPositiveAmount()
    {
        var suggestion = await SuggestionFrom(ReaderReading(merchantName: "Sport", total: 499m, isRefund: true));

        Assert.Equal(499m, suggestion.Amount);
    }

    [Theory]
    [InlineData("NOK")]
    [InlineData("nok")]
    [InlineData(null)]
    [InlineData("")]
    public async Task Post_ReadReceiptInNokOrWithoutACurrency_SuggestsItsAmount(string? currencyCode)
    {
        var suggestion = await SuggestionFrom(ReaderReading(merchantName: "Sport", total: 129.50m, currencyCode: currencyCode));

        Assert.Equal(-129.50m, suggestion.Amount);
    }

    [Fact]
    public async Task Post_ReadReceiptInAForeignCurrency_SuggestsNoAmountButTheRest()
    {
        var suggestion = await SuggestionFrom(ReaderReading(
            purchaseDate: new DateOnly(2026, 7, 3),
            merchantName: "Café de Paris",
            total: 18.40m,
            currencyCode: "EUR",
            categoryName: "Restaurants"));

        Assert.Equal(
            new ReceiptSuggestion(ReceiptOutcome.Read, new DateOnly(2026, 7, 3), "Café de Paris", null, _seeded.Restaurants),
            suggestion);
    }

    [Theory]
    [InlineData("12.345", false, "-12.35")]
    [InlineData("12.344", false, "-12.34")]
    [InlineData("12.345", true, "12.35")]
    public async Task Post_ReadReceiptWithATotalOfMoreThanTwoDecimals_SuggestsItsAmountRoundedAwayFromZero(
        string total, bool isRefund, string amount)
    {
        var suggestion = await SuggestionFrom(ReaderReading(
            merchantName: "Sport", total: decimal.Parse(total, CultureInfo.InvariantCulture), isRefund: isRefund));

        Assert.Equal(decimal.Parse(amount, CultureInfo.InvariantCulture), suggestion.Amount);
    }

    [Fact]
    public async Task Post_ReadReceiptWithATotalThatRoundsToZero_SuggestsNoAmount()
    {
        var suggestion = await SuggestionFrom(ReaderReading(merchantName: "Sport", total: 0.004m));

        Assert.Null(suggestion.Amount);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-25)]
    [InlineData(null)]
    public async Task Post_ReadReceiptWithoutAPositiveTotal_SuggestsNoAmount(int? total)
    {
        var suggestion = await SuggestionFrom(ReaderReading(merchantName: "Sport", total: total));

        Assert.Null(suggestion.Amount);
    }

    [Theory]
    [InlineData("Vipps*Torget Kiosk", "Torget Kiosk")]
    [InlineData("  PAYPAL * Torget Kiosk  ", "Torget Kiosk")]
    // Only a Payment Channel is stripped.
    [InlineData("Butikk*Torget Kiosk", "Butikk*Torget Kiosk")]
    [InlineData("  Torget Kiosk ", "Torget Kiosk")]
    public async Task Post_ReadReceipt_SuggestsTheMerchantNameAsTheDescriptionWithoutAPaymentChannel(
        string merchantName, string description)
    {
        var suggestion = await SuggestionFrom(ReaderReading(merchantName: merchantName, total: 35m));

        Assert.Equal(description, suggestion.Description);
    }

    [Fact]
    public async Task Post_ReadReceiptWithAPaymentChannel_SuggestsTheCategoryOfTheRuleMatchingTheMerchant()
    {
        await AddRule("kiosk", _seeded.Restaurants);

        var suggestion = await SuggestionFrom(ReaderReading(merchantName: "Vipps*Kiosk", total: 35m, categoryName: "Other"));

        Assert.Equal(_seeded.Restaurants, suggestion.CategoryId);
    }

    [Fact]
    public async Task Post_ReadReceiptWithAnOverLongMerchantName_CutsTheDescriptionToTheMaxLength()
    {
        var merchantName = new string('x', AppDbContext.DescriptionMaxLength + 1);

        var suggestion = await SuggestionFrom(ReaderReading(merchantName: merchantName, total: 35m));

        Assert.Equal(merchantName[..AppDbContext.DescriptionMaxLength], suggestion.Description);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Post_ReadReceiptWithABlankMerchantName_SuggestsNoDescription(string merchantName)
    {
        var suggestion = await SuggestionFrom(ReaderReading(merchantName: merchantName, total: 35m));

        Assert.Null(suggestion.Description);
    }

    [Fact]
    public async Task Post_UnreadableReceipt_AnswersUnreadableWithEveryFieldNull()
    {
        var suggestion = await SuggestionFrom(new FakeReceiptReader { Reading = new ReceiptReading.Unreadable() });

        Assert.Equal(new ReceiptSuggestion(ReceiptOutcome.Unreadable, null, null, null, null), suggestion);
    }

    [Fact]
    public async Task Post_ReceiptReadWithNothingMadeOut_AnswersReadWithEveryFieldNull()
    {
        var suggestion = await SuggestionFrom(ReaderReading(currencyCode: null));

        Assert.Equal(new ReceiptSuggestion(ReceiptOutcome.Read, null, null, null, null), suggestion);
    }

    [Fact]
    public async Task Post_Image_ReaderIsGivenTheImageAndEveryCategoryWithItsDescription()
    {
        var reader = new FakeReceiptReader();

        await SuggestionFrom(reader);

        var call = Assert.Single(reader.Calls);
        Assert.Equal(Jpeg, call.Receipt.Image);
        Assert.Equal("image/jpeg", call.Receipt.MediaType);
        Assert.Equal(
            Seeds.Categories.Select(c => new CategoryChoice(c.Name, c.Description)).OrderBy(c => c.Name),
            call.Categories.OrderBy(c => c.Name));
    }

    [Fact]
    public async Task Post_ImageDeclaredAsAnotherType_ReaderIsGivenTheTypeItsBytesShow()
    {
        var reader = new FakeReceiptReader();

        await Read(Png, "kvittering.jpg", "image/jpeg", reader);

        Assert.Equal("image/png", Assert.Single(reader.Calls).Receipt.MediaType);
    }

    [Fact]
    public async Task Post_ReadReceipt_LeavesTransactionsAndCategorizationRulesUnchanged()
    {
        await AddRule("kafé", _seeded.Restaurants);
        var before = await Stored();

        await SuggestionFrom(ReaderReading(merchantName: "Kafé", total: 249.90m, categoryName: "Groceries"));

        Assert.Equal(before, await Stored());
    }

    [Fact]
    public async Task Post_FileThatIsNotAnImage_IsRejectedWithoutAskingTheReader()
    {
        var reader = new FakeReceiptReader();

        var response = await Read("not really a photo"u8.ToArray(), "kvittering.jpg", "image/jpeg", reader);

        Assert.Equal(["The file is not a JPEG, PNG, WebP or GIF image."], await FileErrors(response));
        Assert.Empty(reader.Calls);
    }
}
