using Microsoft.EntityFrameworkCore;
using PersonligFinans.Api.Data;

namespace PersonligFinans.Api.CategorizationRules;

// Owns what a Categorization Rule means. The invariant it keeps: every rule-eligible Transaction
// (imported, and not categorized manually) has the Category of its best-matching current rule,
// or is Uncategorized when no rule matches.
public static class Categorizer
{
    // The rule whose keyword the description contains, ignoring case. The longest keyword wins, so
    // a specific rule overrides a general one; between equally long keywords the oldest rule wins.
    public static CategorizationRule? ChooseRule(string description, IEnumerable<CategorizationRule> rules) =>
        rules
            .Where(r => description.Contains(r.Keyword, StringComparison.OrdinalIgnoreCase))
            .OrderByDescending(r => r.Keyword.Length)
            .ThenBy(r => r.CreatedAt)
            .ThenBy(r => r.Id)
            .FirstOrDefault();

    // Re-matches every rule-eligible Transaction against the rules tracked by db, including ones
    // added but not yet saved, and returns how many changed Category. Nothing is saved here, so the
    // caller saves the rule change and the re-matched Transactions together.
    public static async Task<int> RematchAsync(AppDbContext db)
    {
        await db.CategorizationRules.LoadAsync();
        var rules = db.CategorizationRules.Local.ToList();

        var eligible = await db.Transactions
            .Where(t => t.BankStatementId != null && (t.CategorizationRuleId != null || t.CategoryId == null))
            .ToListAsync();

        var changed = 0;
        foreach (var transaction in eligible)
        {
            var rule = ChooseRule(transaction.Description, rules);
            var categoryId = rule?.CategoryId;
            if (transaction.CategoryId != categoryId)
                changed++;
            transaction.CategoryId = categoryId;
            transaction.CategorizationRule = rule;
            if (rule is null)
                transaction.CategorizationRuleId = null;
        }

        return changed;
    }
}
