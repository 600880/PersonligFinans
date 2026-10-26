using PersonligFinans.Api.CategorizationRules;

namespace PersonligFinans.Api.Data;

public class CategorizationRule : ICategorizationRule
{
    public int Id { get; set; }

    // The User it belongs to.
    public required string UserId { get; set; }

    // Matched against a Transaction's description, ignoring case. Unique among the User's rules,
    // ignoring case.
    public required string Keyword { get; set; }

    public int CategoryId { get; set; }
    public Category? Category { get; set; }

    // Breaks ties between equally long matching keywords: the oldest rule wins.
    public DateTimeOffset CreatedAt { get; set; }

    // Created by an LLM during import and not yet edited by the user, so the user can find it to
    // review. Set at creation and cleared by the first edit; changes nothing about matching.
    public bool AiGenerated { get; set; }

    // The Upload whose import added the rule; null for a rule added by hand or seeded. A rule added
    // by the most recent Upload that imported a Bank Statement is New. Unlike AiGenerated, editing
    // the rule keeps it.
    public Guid? UploadId { get; set; }
}
