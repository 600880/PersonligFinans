using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using PersonligFinans.Api.AiRequests;
using PersonligFinans.Api.BankStatements;
using PersonligFinans.Api.CategorizationRules;
using PersonligFinans.Api.Data;
using PersonligFinans.Api.Transactions;
using PersonligFinans.Api.Users;

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

    // The Daily AI limit was reached, so the receipt reader wasn't asked.
    [JsonStringEnumMemberName("limitReached")] LimitReached,
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

    public static readonly ReceiptSuggestion LimitReached = new(ReceiptOutcome.LimitReached, null, null, null, null);
}

public static class ReceiptEndpoints
{
    private const long MaxFileBytes = 10 * 1024 * 1024;

    private static readonly byte[] JpegStart = [0xFF, 0xD8, 0xFF];
    private static readonly byte[] PngStart = [0x89, .."PNG"u8, 0x0D, 0x0A, 0x1A, 0x0A];

    public static void MapReceiptEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api");

        api.MapPost("/receipts/read", ReadReceipt).RequireAntiforgeryToken();
        api.MapPost("/transactions/with-receipt", CreateTransactionWithReceipt).RequireAntiforgeryToken();
        api.MapGet("/transactions/{id:int}/receipt", ServeReceipt);
    }

    // Creates a manually-entered Transaction together with its Receipt, kept with it, as the Receipt
    // scan's Save does when the Receipt is to be kept. A multipart form: the transaction field holds
    // the JSON create's request, Bookmark included, and the receipt field the Receipt's image. It is
    // validated as the JSON create is, along with the Receipt, and answered as the JSON create is.
    // Any failure saves nothing. The form is read by hand, as at reading a Receipt, so that a missing
    // or oversized Receipt gets the same validation problem.
    private static async Task<IResult> CreateTransactionWithReceipt(
        HttpRequest request, AppDbContext db, IOptions<Microsoft.AspNetCore.Http.Json.JsonOptions> jsonOptions)
    {
        IFormCollection? form;
        try
        {
            form = request.HasFormContentType ? await request.ReadFormAsync() : null;
        }
        catch (BadHttpRequestException e) when (e.StatusCode == StatusCodes.Status413PayloadTooLarge)
        {
            // Kestrel's own request size limit (30 MB) was hit while reading the form.
            return ReceiptProblem("The Receipt is larger than 10 MB.");
        }

        var errors = new Dictionary<string, string[]>();

        var (image, receiptError) = await KeptImageOf(form?.Files.GetFile("receipt"));
        if (receiptError is not null)
            errors["receipt"] = [receiptError];

        var transaction = TransactionRequestOf(form?["transaction"], jsonOptions.Value.SerializerOptions);
        if (transaction is null)
            errors["transaction"] = ["The transaction is missing or is not valid JSON."];
        else
            foreach (var (field, messages) in await TransactionEndpoints.ValidateNew(transaction, db))
                errors[field] = messages;

        if (errors.Count > 0)
            return Results.ValidationProblem(errors);

        return await TransactionEndpoints.SaveNew(transaction!, image, db);
    }

    // The image of a Receipt to keep, or why it can't be kept. Only a JPEG is kept, told from its
    // leading bytes since the declared type isn't trusted: every Receipt is reduced to one when picked.
    private static async Task<(byte[]? Image, string? Error)> KeptImageOf(IFormFile? file)
    {
        if (file is null || file.Length == 0)
            return (null, "Choose a Receipt to keep.");
        if (file.Length > MaxFileBytes)
            return (null, "The Receipt is larger than 10 MB.");

        using var bytes = new MemoryStream();
        await using (var stream = file.OpenReadStream())
            await stream.CopyToAsync(bytes);
        var image = bytes.ToArray();
        return image.AsSpan().StartsWith(JpegStart) ? (image, null) : (null, "The Receipt is not a JPEG image.");
    }

    // The JSON create's request held in the form's transaction field, read as the JSON create reads
    // its body, or null when there is none or it isn't one.
    private static CreateTransactionRequest? TransactionRequestOf(string? json, JsonSerializerOptions options)
    {
        if (string.IsNullOrEmpty(json))
            return null;
        try
        {
            return JsonSerializer.Deserialize<CreateTransactionRequest>(json, options);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    // The Transaction's kept Receipt, as the JPEG it was kept as. A Transaction that doesn't exist, is
    // another User's or has no Receipt is answered alike, so nobody can tell which. Never stored by
    // the browser, so that whoever signs in next on a shared browser can't be shown it.
    private static async Task<IResult> ServeReceipt(int id, AppDbContext db, HttpResponse response)
    {
        var image = await db.Receipts
            .Where(r => r.TransactionId == id)
            .Select(r => r.Image)
            .SingleOrDefaultAsync();
        if (image is null)
            return Results.NotFound();

        response.Headers.CacheControl = "no-store";
        return Results.Bytes(image, "image/jpeg");
    }

    // Suggests a manually-entered Transaction from one Receipt's image. The form is read by hand
    // rather than bound to an IFormFile, so that a missing or oversized file gets the same validation
    // problem as every other rejected file. The image is only passed to the receipt reader, never
    // stored or logged, and nothing but the AI request is written to the database.
    // The receipt reader is optional: without one, every Receipt is answered Unavailable.
    // Reading a Receipt is one AI request, taken once the image is accepted. Past the Daily AI limit
    // the reader isn't asked, and the Receipt is answered LimitReached.
    private static async Task<IResult> ReadReceipt(
        HttpRequest request, AppDbContext db, AiRequestLedger ledger, [FromServices] IReceiptReader? receiptReader)
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

        Receipt receipt;
        await using (var stream = file.OpenReadStream())
        {
            if (await ImageTypeOf(stream) is not { } mediaType)
                return FileProblem("The file is not a JPEG, PNG, WebP or GIF image.");
            if (receiptReader is null)
                return Results.Ok(ReceiptSuggestion.Unavailable);

            using var bytes = new MemoryStream();
            await stream.CopyToAsync(bytes);
            receipt = new Receipt(bytes.ToArray(), mediaType);
        }

        if (!await ledger.TryTakeAsync())
            return Results.Ok(ReceiptSuggestion.LimitReached);

        // Read for each Receipt, so an edited Category description reaches the next reading.
        var categories = await db.Categories.AsNoTracking().OrderBy(c => c.Name).ToListAsync();
        var reading = await receiptReader.ReadAsync(
            receipt, categories.Select(c => new CategoryChoice(c.Name, c.Description)).ToList());
        if (reading is not ReceiptReading.Read read)
            return Results.Ok(ReceiptSuggestion.Unreadable);

        var description = DescriptionOf(read);
        var rules = await db.CategorizationRules.AsNoTracking().ToListAsync();
        return Results.Ok(new ReceiptSuggestion(
            ReceiptOutcome.Read, read.PurchaseDate, description, AmountOf(read), CategoryIdOf(description, read, rules, categories)));
    }

    // The Category of the rule matching the Description, chosen as the import chooses one, so a
    // Receipt gets the Category its merchant's imported Transactions get. Only without one does the
    // reader's Category count, found by its name, which is unique among the User's Categories
    // ignoring case.
    private static int? CategoryIdOf(
        string? description, ReceiptReading.Read read, List<CategorizationRule> rules, List<Category> categories) =>
        (description is null ? null : Categorizer.ChooseRule(description, rules)?.CategoryId)
        ?? categories.FirstOrDefault(c => string.Equals(c.Name, read.CategoryName, StringComparison.OrdinalIgnoreCase))?.Id;

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

    // The signed Amount of what was read: negative for a purchase, positive for a refund, rounded to
    // whole øre away from zero, whichever reader read it. Null unless a total that is positive once
    // rounded was read in NOK, so a foreign total is never mistaken for one in NOK. A Receipt with no
    // currency printed is in NOK.
    private static decimal? AmountOf(ReceiptReading.Read read)
    {
        var currencyCode = string.IsNullOrWhiteSpace(read.CurrencyCode) ? "NOK" : read.CurrencyCode.Trim();
        decimal? total = read.Total is { } t ? Math.Round(t, 2, MidpointRounding.AwayFromZero) : null;
        if (total is not > 0 || !string.Equals(currencyCode, "NOK", StringComparison.OrdinalIgnoreCase))
            return null;
        return read.IsRefund ? total : -total;
    }

    private static IResult FileProblem(string message) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { ["file"] = [message] });

    private static IResult ReceiptProblem(string message) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { ["receipt"] = [message] });

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
