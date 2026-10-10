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

    // The Categorization Rule that assigned the Category. An imported Transaction with a Category
    // but no rule was categorized manually, so rules never change it, unless it is AI-placed in Other.
    public int? CategorizationRuleId { get; set; }
    public CategorizationRule? CategorizationRule { get; set; }

    // AI-placed in Other: the LLM put this imported Transaction in Other during import, without a
    // rule. Rules may still claim it, and it falls back to Other when none matches, so the mark is
    // kept while a rule holds it. Cleared when the user changes its Category.
    public bool AiPlacedInOther { get; set; }

    // Null for manually-entered Transactions.
    public int? BankStatementId { get; set; }
    public BankStatement? BankStatement { get; set; }
}
