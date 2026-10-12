namespace PersonligFinans.Api.Data;

public class BankStatement
{
    public int Id { get; set; }
    public required string AccountNumber { get; set; }
    public DateOnly PeriodStart { get; set; }
    public DateOnly PeriodEnd { get; set; }
    public decimal OpeningBalance { get; set; }
    public decimal ClosingBalance { get; set; }
    public DateTimeOffset ImportedAt { get; set; }

    // The Upload it was imported in. The Bank Statements imported before Uploads were recorded
    // share the empty id, which no rule has.
    public Guid UploadId { get; set; }

    public List<Transaction> Transactions { get; } = [];
}
