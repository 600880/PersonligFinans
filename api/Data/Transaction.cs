namespace PersonligFinans.Api.Data;

public class Transaction
{
    public int Id { get; set; }
    public DateOnly PostedDate { get; set; }
    public required string Description { get; set; }

    // Signed, in NOK: negative = spent, positive = received. Never zero.
    public decimal Amount { get; set; }

    public string? Reference { get; set; }

    // Null means Uncategorized.
    public int? CategoryId { get; set; }
    public Category? Category { get; set; }
}
