namespace PersonligFinans.Api.CategorizationRules;

public enum AmountSign { Negative, Positive }

// An imported row that no Categorization Rule matches, as the rule generator sees it: the cleaned
// description and whether money was spent or received, never the Amount itself.
public record UnmatchedRow(string Description, AmountSign Sign);

// A Category the rule generator may choose, as it sees it: its name and the description of what
// belongs in it.
public record CategoryChoice(string Name, string Description);

// A keyword and the name of the Category it should assign, proposed for one unmatched row.
public record RuleProposal(string Keyword, string CategoryName);

// The outcome of one call to the rule generator.
public abstract record RuleGeneration
{
    // A proposal for each row the generator didn't decline. Declined rows have no entry; the import
    // AI-places them in Other.
    public sealed record Generated(IReadOnlyDictionary<UnmatchedRow, RuleProposal> Proposals) : RuleGeneration;

    // The generator failed (timeout, rate limit, network, malformed response), so every row is
    // left as it is.
    public sealed record Unavailable : RuleGeneration;
}

// Proposes AI-generated rules: for each unmatched row, a keyword and the name of one of the given
// Categories, or nothing when it declines. Never throws; any failure is reported as Unavailable.
public interface IRuleGenerator
{
    Task<RuleGeneration> GenerateAsync(IReadOnlyList<UnmatchedRow> rows, IReadOnlyList<CategoryChoice> categories);
}
