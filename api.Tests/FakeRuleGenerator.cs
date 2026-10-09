using PersonligFinans.Api.CategorizationRules;

namespace PersonligFinans.Api.Tests;

// Stands in for the LLM: proposes what the test scripted for each description, declines every
// other row, and remembers what it was asked.
public class FakeRuleGenerator : IRuleGenerator
{
    private readonly Dictionary<string, RuleProposal> _proposals = [];

    public bool Unavailable { get; init; }

    public List<(IReadOnlyList<UnmatchedRow> Rows, IReadOnlyList<string> CategoryNames)> Calls { get; } = [];

    public FakeRuleGenerator Proposing(string description, string keyword, string categoryName)
    {
        _proposals[description] = new RuleProposal(keyword, categoryName);
        return this;
    }

    public Task<RuleGeneration> GenerateAsync(IReadOnlyList<UnmatchedRow> rows, IReadOnlyList<string> categoryNames)
    {
        Calls.Add((rows, categoryNames));
        if (Unavailable)
            return Task.FromResult<RuleGeneration>(new RuleGeneration.Unavailable());

        var proposals = rows
            .Where(r => _proposals.ContainsKey(r.Description))
            .ToDictionary(r => r, r => _proposals[r.Description]);
        return Task.FromResult<RuleGeneration>(new RuleGeneration.Generated(proposals));
    }
}
