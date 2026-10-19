namespace PersonligFinans.Api.Data;

public class Transaction
{
    public int Id { get; set; }

    // The User it belongs to.
    public required string UserId { get; set; }
    public DateOnly PostedDate { get; set; }
    public required string Description { get; set; }

    // Signed, in NOK: negative = spent, positive = received. Never zero.
    public decimal Amount { get; set; }

    public string? Note { get; set; }

    // Null means Uncategorized.
    public int? CategoryId { get; set; }
    public Category? Category { get; set; }

    // The Categorization Rule that assigned the Category. An imported Transaction with a Category
    // but no rule was categorized manually, so rules never change it.
    public int? CategorizationRuleId { get; set; }
    public CategorizationRule? CategorizationRule { get; set; }

    // Null for manually-entered Transactions.
    public int? BankStatementId { get; set; }
    public BankStatement? BankStatement { get; set; }

    // Imported from a Bank Statement rather than entered manually, so it can't be deleted.
    public bool IsImported => BankStatementId is not null;
}
