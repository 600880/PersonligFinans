using PersonligFinans.Api.CategorizationRules;
using PersonligFinans.Api.Receipts;

namespace PersonligFinans.Api.Tests;

// Stands in for the LLM: answers every Receipt with what the test scripted, Unreadable unless told
// otherwise, and remembers what it was asked.
public class FakeReceiptReader : IReceiptReader
{
    public ReceiptReading Reading { get; init; } = new ReceiptReading.Unreadable();

    public List<(ReceiptImage Image, IReadOnlyList<CategoryChoice> Categories)> Calls { get; } = [];

    public Task<ReceiptReading> ReadAsync(ReceiptImage image, IReadOnlyList<CategoryChoice> categories)
    {
        Calls.Add((image, categories));
        return Task.FromResult(Reading);
    }
}
