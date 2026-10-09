namespace PersonligFinans.Api.Data;

public class CategorizationRule
{
    public int Id { get; set; }

    // Matched against a Transaction's description, ignoring case. Unique, ignoring case.
    public required string Keyword { get; set; }

    public int CategoryId { get; set; }
    public Category? Category { get; set; }

    // Breaks ties between equally long matching keywords: the oldest rule wins.
    public DateTimeOffset CreatedAt { get; set; }

    // Created by an LLM during import rather than by hand. Only records where the rule came from:
    // set once at creation and kept through edits.
    public bool AiGenerated { get; set; }
}
