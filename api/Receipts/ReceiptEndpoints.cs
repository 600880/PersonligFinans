using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PersonligFinans.Api.BankStatements;
using PersonligFinans.Api.CategorizationRules;
using PersonligFinans.Api.Data;

namespace PersonligFinans.Api.Receipts;

[JsonConverter(typeof(JsonStringEnumConverter<ReceiptOutcome>))]
public enum ReceiptOutcome
{
    // The receipt reader read the Receipt.
    [JsonStringEnumMemberName("read")] Read,

    // The receipt reader couldn't read the Receipt.
    [JsonStringEnumMemberName("unreadable")] Unreadable,

    // No receipt reader is configured.
    [JsonStringEnumMemberName("unavailable")] Unavailable,
}

// What a manually-entered Transaction from one Receipt should start from. Amount is signed: negative
// for a purchase, positive for a refund. Every field is null unless the outcome is Read.
public record ReceiptSuggestion(
    ReceiptOutcome Outcome,
    DateOnly? Date,
    string? Description,
    decimal? Amount,
    int? CategoryId)
{
    public static readonly ReceiptSuggestion Unreadable = new(ReceiptOutcome.Unreadable, null, null, null, null);

    public static readonly ReceiptSuggestion Unavailable = new(ReceiptOutcome.Unavailable, null, null, null, null);
}

public static class ReceiptEndpoints
{
    private const long MaxFileBytes = 10 * 1024 * 1024;

    private static readonly byte[] JpegStart = [0xFF, 0xD8, 0xFF];
    private static readonly byte[] PngStart = [0x89, .."PNG"u8, 0x0D, 0x0A, 0x1A, 0x0A];

    public static void MapReceiptEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api");

        // A JSON API without cookie auth, so there is no forgery risk to guard the form against.
        api.MapPost("/receipts/read", ReadReceipt).DisableAntiforgery();
    }

    // Suggests a manually-entered Transaction from one Receipt's image. The form is read by hand
    // rather than bound to an IFormFile, so that a missing or oversized file gets the same validation
    // problem as every other rejected file. The image is only passed to the receipt reader, never
    // stored or logged, and nothing is written to the database.
    // The receipt reader is optional: without one, every Receipt is answered Unavailable.
    private static async Task<IResult> ReadReceipt(
        HttpRequest request, AppDbContext db, [FromServices] IReceiptReader? receiptReader)
    {
        IFormFile? file;
        try
        {
            var form = request.HasFormContentType ? await request.ReadFormAsync() : null;
            file = form?.Files.GetFile("file");
        }
        catch (BadHttpRequestException e) when (e.StatusCode == StatusCodes.Status413PayloadTooLarge)
        {
            // Kestrel's own request size limit (30 MB) was hit while reading the form.
            return FileProblem("The file is larger than 10 MB.");
        }

        if (file is null || file.Length == 0)
            return FileProblem("Choose a Receipt to read.");
        if (file.Length > MaxFileBytes)
            return FileProblem("The file is larger than 10 MB.");

        ReceiptImage image;
        await using (var stream = file.OpenReadStream())
        {
            if (await ImageTypeOf(stream) is not { } mediaType)
                return FileProblem("The file is not a JPEG, PNG, WebP or GIF image.");
            if (receiptReader is null)
                return Results.Ok(ReceiptSuggestion.Unavailable);

            using var bytes = new MemoryStream();
            await stream.CopyToAsync(bytes);
            image = new ReceiptImage(bytes.ToArray(), mediaType);
        }

        // Read at each Receipt, so an edited description reaches the next prompt.
        var categories = await db.Categories.AsNoTracking().OrderBy(c => c.Name).ToListAsync();
        var reading = await receiptReader.ReadAsync(
            image, categories.Select(c => new CategoryChoice(c.Name, c.Description)).ToList());
        if (reading is not ReceiptReading.Read read)
            return Results.Ok(ReceiptSuggestion.Unreadable);

        var description = DescriptionOf(read);
        // The rule matching the Description wins, chosen as the import chooses one, so a Receipt gets
        // the Category its merchant's imported Transactions get. Only without one does the reader's
        // Category count; names are unique ignoring case.
        var rules = await db.CategorizationRules.AsNoTracking().ToListAsync();
        var categoryId = (description is null ? null : Categorizer.ChooseRule(description, rules)?.CategoryId)
            ?? categories.FirstOrDefault(c => string.Equals(c.Name, read.CategoryName, StringComparison.OrdinalIgnoreCase))?.Id;
        return Results.Ok(new ReceiptSuggestion(ReceiptOutcome.Read, read.PurchaseDate, description, AmountOf(read), categoryId));
    }

    // The merchant name read, as an imported Transaction's Description would be: without a Payment
    // Channel in front of it, trimmed and cut to the Description max length. Null when blank.
    private static string? DescriptionOf(ReceiptReading.Read read)
    {
        if (read.MerchantName is null)
            return null;
        var merchant = DescriptionCleaner.StripPaymentChannel(read.MerchantName.Trim()).Trim();
        var description = DescriptionCleaner.CutToMaxLength(merchant).TrimEnd();
        return description == "" ? null : description;
    }

    // The signed Amount of what was read: negative for a purchase, positive for a refund. Null
    // unless a positive total was read in NOK, so a foreign total is never mistaken for one in NOK.
    // A Receipt with no currency printed is in NOK.
    private static decimal? AmountOf(ReceiptReading.Read read)
    {
        var currencyCode = string.IsNullOrWhiteSpace(read.CurrencyCode) ? "NOK" : read.CurrencyCode.Trim();
        if (read.Total is not > 0 || !string.Equals(currencyCode, "NOK", StringComparison.OrdinalIgnoreCase))
            return null;
        return read.IsRefund ? read.Total : -read.Total;
    }

    private static IResult FileProblem(string message) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { ["file"] = [message] });

    // The image's media type, told from its leading bytes since the declared type isn't trusted, or
    // null when it isn't a JPEG, PNG, WebP or GIF. The stream is rewound afterwards.
    private static async Task<string?> ImageTypeOf(Stream file)
    {
        var header = new byte[12];
        var read = await file.ReadAtLeastAsync(header, header.Length, throwOnEndOfStream: false);
        file.Position = 0;
        var start = header.AsSpan(0, read);

        if (start.StartsWith(JpegStart))
            return "image/jpeg";
        if (start.StartsWith(PngStart))
            return "image/png";
        // A RIFF container, whose size field sits between the two tags.
        if (read == header.Length && start.StartsWith("RIFF"u8) && start[8..].SequenceEqual("WEBP"u8))
            return "image/webp";
        if (start.StartsWith("GIF87a"u8) || start.StartsWith("GIF89a"u8))
            return "image/gif";
        return null;
    }
}
