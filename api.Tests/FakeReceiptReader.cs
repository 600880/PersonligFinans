using PersonligFinans.Api.CategorizationRules;
using PersonligFinans.Api.Receipts;

namespace PersonligFinans.Api.Tests;

// Stands in for the LLM: answers every Receipt with what the test scripted, Unreadable unless told
// otherwise, and remembers what it was asked, even when asked about several Receipts at once.
public class FakeReceiptReader : IReceiptReader
{
    public ReceiptReading Reading { get; init; } = new ReceiptReading.Unreadable();

    public List<(Receipt Receipt, IReadOnlyList<CategoryChoice> Categories)> Calls { get; } = [];

    public Task<ReceiptReading> ReadAsync(Receipt receipt, IReadOnlyList<CategoryChoice> categories)
    {
        lock (Calls)
            Calls.Add((receipt, categories));
        return Task.FromResult(Reading);
    }
}
