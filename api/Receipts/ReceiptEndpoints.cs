using System.Text.Json.Serialization;

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
    // problem as every other rejected file. The image is only looked at, never stored or logged, and
    // nothing is written to the database. There is no receipt reader yet, so every Receipt is
    // answered Unavailable.
    private static async Task<IResult> ReadReceipt(HttpRequest request)
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

        await using (var image = file.OpenReadStream())
        {
            if (await ImageTypeOf(image) is null)
                return FileProblem("The file is not a JPEG, PNG, WebP or GIF image.");
        }

        return Results.Ok(ReceiptSuggestion.Unavailable);
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
