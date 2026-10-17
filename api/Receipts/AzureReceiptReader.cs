using System.Globalization;
using System.Text.Encodings.Web;
using System.Text.Json;
using OpenAI.Chat;
using PersonligFinans.Api.CategorizationRules;

namespace PersonligFinans.Api.Receipts;

// The receipt reader backed by a chat model deployed on Azure, which must accept image input: one call
// per Receipt, sending the whole image (see ADR 0004) and each Category's name and description, and
// answered with JSON that must follow a schema.
public class AzureReceiptReader(ChatClient chat, ILogger<AzureReceiptReader> logger, TimeSpan? timeLimit = null)
    : IReceiptReader
{
    // Long enough for a photo to be read, short enough that a Receipt scan never hangs on one Receipt.
    private static readonly TimeSpan DefaultTimeLimit = TimeSpan.FromSeconds(30);

    private const string Instructions = """
        You read receipts for a personal finance app. The receipts are norwegian, so use what you know
        about norwegian merchants, receipts and dates. You get a photo of one receipt and the list of
        categories, each with a name and a description of what belongs in it.

        When the photo is not of a receipt, set notAReceipt to true, isRefund to false and every other
        field to null.
        Otherwise set notAReceipt to false and read:
        - purchaseDate: the date of the purchase, as YYYY-MM-DD. Norwegian receipts write the day
          first, such as 12.10.2026 or 12.10.26. Ignore any other date, such as a return deadline.
        - merchantName: the name of the store or business, without store numbers, addresses,
          organisation numbers or payment services that carry payments for many merchants, such as
          Vipps, Klarna or PayPal. For example, "KIWI 512 Bergen Sentrum" gives "KIWI".
        - total: the amount actually paid, as a positive number: the final total after discounts,
          not a subtotal, the VAT, the amount handed over or the change given back.
        - currencyCode: the ISO 4217 code of the total's currency, such as NOK or EUR; "kr" on a
          norwegian receipt is NOK. Null when no currency is printed.
        - isRefund: true when the receipt is for a return or refund, so that money was paid back to
          the customer, for example one marked "Retur", "Refusjon" or "Kreditnota".
        - category: the name of one of the given categories, chosen by what the categories'
          descriptions say belongs in them, for what was bought.
        Leave any of purchaseDate, merchantName, total, currencyCode and category null when you can't
        make it out, rather than guessing.
        """;

    private static readonly JsonSerializerOptions PromptJson = new(JsonSerializerDefaults.Web)
    {
        // Keeps Norwegian letters readable for the model rather than escaped.
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    // Missing or null required values make the answer malformed rather than defaulting silently.
    private static readonly JsonSerializerOptions AnswerJson = new(JsonSerializerDefaults.Web)
    {
        RespectNullableAnnotations = true,
        RespectRequiredConstructorParameters = true,
    };

    private record Prompt(IReadOnlyList<CategoryChoice> Categories);

    private record Answer(
        bool NotAReceipt,
        string? PurchaseDate,
        string? MerchantName,
        decimal? Total,
        string? CurrencyCode,
        bool IsRefund,
        string? Category);

    // Logs only the image's size and media type besides the failure: never the image, nor anything the
    // model read from it.
    public async Task<ReceiptReading> ReadAsync(Receipt receipt, IReadOnlyList<CategoryChoice> categories)
    {
        try
        {
            using var timeout = new CancellationTokenSource(timeLimit ?? DefaultTimeLimit);
            ChatCompletion completion = await chat.CompleteChatAsync(
                [
                    new SystemChatMessage(Instructions),
                    new UserChatMessage(
                        ChatMessageContentPart.CreateImagePart(BinaryData.FromBytes(receipt.Image), receipt.MediaType),
                        ChatMessageContentPart.CreateTextPart(JsonSerializer.Serialize(new Prompt(categories), PromptJson))),
                ],
                new ChatCompletionOptions
                {
                    ResponseFormat = ChatResponseFormat.CreateJsonSchemaFormat(
                        "receipt", AnswerSchema(categories.Select(c => c.Name)), jsonSchemaIsStrict: true),
                },
                timeout.Token);

            var answer = JsonSerializer.Deserialize<Answer>(completion.Content[0].Text, AnswerJson)
                ?? throw new JsonException("The answer is null.");
            if (answer.NotAReceipt)
            {
                logger.LogInformation(
                    "The receipt reader found no receipt in a {MediaType} image of {ByteCount} bytes.",
                    receipt.MediaType, receipt.Image.Length);
                return new ReceiptReading.Unreadable();
            }
            return new ReceiptReading.Read(
                PurchaseDateOf(answer), answer.MerchantName, answer.Total, answer.CurrencyCode, answer.IsRefund, answer.Category);
        }
        catch (JsonException)
        {
            // Logged without the exception, whose message can quote the answer.
            logger.LogWarning(
                "The receipt reader's answer for a {MediaType} image of {ByteCount} bytes was not the JSON asked for.",
                receipt.MediaType, receipt.Image.Length);
            return new ReceiptReading.Unreadable();
        }
        catch (Exception e)
        {
            // The exception describes the failure (an error status, the network, the time limit), not
            // the Receipt.
            logger.LogWarning(
                e, "The receipt reader was unavailable for a {MediaType} image of {ByteCount} bytes.",
                receipt.MediaType, receipt.Image.Length);
            return new ReceiptReading.Unreadable();
        }
    }

    // The purchase date answered, or null when it isn't an ISO date: a date the model wrote some other
    // way is left out rather than making the whole Receipt unreadable.
    private static DateOnly? PurchaseDateOf(Answer answer) =>
        DateOnly.TryParseExact(answer.PurchaseDate, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)
            ? date
            : null;

    // The schema the answer must follow. Strict mode needs every property required and no others, so
    // a field that can't be made out is null rather than left out. The Category is given by name
    // alone; null is among its choices.
    private static BinaryData AnswerSchema(IEnumerable<string> categoryNames) =>
        BinaryData.FromObjectAsJson(new
        {
            type = "object",
            properties = new
            {
                notAReceipt = new { type = "boolean" },
                purchaseDate = new { type = new[] { "string", "null" }, description = "YYYY-MM-DD" },
                merchantName = new { type = new[] { "string", "null" } },
                total = new { type = new[] { "number", "null" } },
                currencyCode = new { type = new[] { "string", "null" } },
                isRefund = new { type = "boolean" },
                category = new { type = new[] { "string", "null" }, @enum = categoryNames.Append(null).ToArray() },
            },
            required = new[] { "notAReceipt", "purchaseDate", "merchantName", "total", "currencyCode", "isRefund", "category" },
            additionalProperties = false,
        });
}
