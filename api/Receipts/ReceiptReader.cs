using PersonligFinans.Api.CategorizationRules;

namespace PersonligFinans.Api.Receipts;

// One Receipt's image as the receipt reader sees it: its bytes, and its media type as told from
// those bytes, e.g. "image/jpeg".
public record ReceiptImage(byte[] Bytes, string MediaType);

// The outcome of reading one Receipt.
public abstract record ReceiptReading
{
    // What the reader made out on the Receipt; any field it couldn't make out is null. Total is the
    // amount paid as a positive number, in the currency of CurrencyCode (e.g. "NOK") when one is
    // printed. CategoryName is one of the given Categories' names.
    public sealed record Read(
        DateOnly? PurchaseDate,
        string? MerchantName,
        decimal? Total,
        string? CurrencyCode,
        bool IsRefund,
        string? CategoryName) : ReceiptReading;

    // The image isn't a legible receipt, or the reader failed (timeout, network, malformed
    // response).
    public sealed record Unreadable : ReceiptReading;
}

// Reads a Receipt's image: the purchase it records, and which of the given Categories it belongs
// in. Never throws; any failure is reported as Unreadable.
public interface IReceiptReader
{
    Task<ReceiptReading> ReadAsync(ReceiptImage image, IReadOnlyList<CategoryChoice> categories);
}
