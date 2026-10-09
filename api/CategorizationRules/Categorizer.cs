using System.Linq.Expressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using PersonligFinans.Api.Data;

namespace PersonligFinans.Api.CategorizationRules;

// Owns what a Categorization Rule means. The invariant it keeps: every rule-eligible Transaction
// (imported, and not categorized manually) has the Category of its best-matching current rule,
// or is Uncategorized when no rule matches.
public static class Categorizer
{
    // A one-letter keyword would match nearly every description.
    public const int KeywordMinLength = 2;

    // Imported, and not categorized manually: categorized by a rule, or Uncategorized.
    private static readonly Expression<Func<Transaction, bool>> IsRuleEligible =
        t => t.BankStatementId != null && (t.CategorizationRuleId != null || t.CategoryId == null);

    // The rule whose keyword the description contains, ignoring case. The longest keyword wins, so
    // a specific rule overrides a general one; between equally long keywords the oldest rule wins.
    public static CategorizationRule? ChooseRule(string description, IEnumerable<CategorizationRule> rules) =>
        rules
            .Where(r => description.Contains(r.Keyword, StringComparison.OrdinalIgnoreCase))
            .OrderByDescending(r => r.Keyword.Length)
            .ThenBy(r => r.CreatedAt)
            .ThenBy(r => r.Id)
            .FirstOrDefault();

    // Saves the rule change tracked by db together with the re-match it causes, in one database
    // transaction, and returns how many Transactions changed Category. The rules table is locked
    // first, so concurrent rule changes run one after another and each re-matches against the rules
    // as the previous one left them.
    public static async Task<int> SaveRuleChangeAsync(AppDbContext db)
    {
        await using var transaction = await BeginRuleChangeAsync(db);
        var changed = await RematchAsync(db);
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
        return changed;
    }

    // Opens the database transaction for a rule change and takes the rule-change lock. It conflicts
    // with itself, so whoever changes rules waits for the previous change to commit first.
    public static async Task<IDbContextTransaction> BeginRuleChangeAsync(AppDbContext db)
    {
        var transaction = await db.Database.BeginTransactionAsync();
        await db.Database.ExecuteSqlRawAsync("LOCK TABLE categorization_rules IN SHARE ROW EXCLUSIVE MODE");
        return transaction;
    }

    // Adds an AI-generated rule for each proposal, one at a time in order, and returns all rules,
    // including the added ones. Each proposal is checked against the rules as they stand at its
    // turn, including the ones added before it, and dropped unless:
    // - no rule matches its row's description;
    // - its Category exists;
    // - its keyword, trimmed and lowercased, is within the length limits, appears in the row's
    //   description ignoring case, and is unique ignoring case;
    // - it would change the Category of nothing that has one: no rule-eligible Transaction, and none
    //   of the descriptions about to be imported. It may only categorize what is Uncategorized.
    // Each added rule is saved at once, so that the uniqueness check is made by the database,
    // comparing keywords exactly as its unique index does. Call it inside the database transaction
    // of a rule change, so the checks see every rule and the rules are undone with the change.
    public static async Task<List<CategorizationRule>> AddAiGeneratedRulesAsync(
        AppDbContext db,
        IEnumerable<(string Description, RuleProposal Proposal)> proposals,
        IEnumerable<string> importedDescriptions)
    {
        await db.CategorizationRules.LoadAsync();
        var rules = db.CategorizationRules.Local.ToList();
        var categoryIdByName = await db.Categories.ToDictionaryAsync(c => c.Name, c => c.Id);
        var eligibleDescriptions = await db.Transactions.Where(IsRuleEligible).Select(t => t.Description).ToListAsync();
        var descriptions = eligibleDescriptions.Concat(importedDescriptions).Distinct().ToList();
        var now = DateTimeOffset.UtcNow;

        foreach (var (description, proposal) in proposals)
        {
            var keyword = proposal.Keyword.Trim().ToLowerInvariant();
            if (ChooseRule(description, rules) is not null ||
                !categoryIdByName.TryGetValue(proposal.CategoryName, out var categoryId) ||
                keyword.Length is < KeywordMinLength or > AppDbContext.KeywordMaxLength ||
                !description.Contains(keyword, StringComparison.OrdinalIgnoreCase))
                continue;

            var rule = new CategorizationRule
            {
                Keyword = keyword,
                CategoryId = categoryId,
                CreatedAt = now,
                AiGenerated = true,
            };
            if (WouldChangeACategory(rule, descriptions, rules) ||
                await db.CategorizationRules.AnyAsync(r => r.Keyword.ToLower() == keyword.ToLower()))
                continue;

            db.CategorizationRules.Add(rule);
            await db.SaveChangesAsync();
            rules.Add(rule);
        }

        return rules;
    }

    // Whether adding the rule would give any of the descriptions that a rule already matches
    // another Category.
    private static bool WouldChangeACategory(
        CategorizationRule rule, IEnumerable<string> descriptions, List<CategorizationRule> rules) =>
        descriptions
            .Where(d => d.Contains(rule.Keyword, StringComparison.OrdinalIgnoreCase))
            .Any(d => ChooseRule(d, rules) is { } current &&
                ChooseRule(d, [.. rules, rule])!.CategoryId != current.CategoryId);

    // Re-matches every rule-eligible Transaction against the rules tracked by db, including ones
    // added, changed or deleted but not yet saved, and returns how many changed Category.
    public static async Task<int> RematchAsync(AppDbContext db)
    {
        await db.CategorizationRules.LoadAsync();
        var rules = db.CategorizationRules.Local.ToList();

        var eligible = await db.Transactions.Where(IsRuleEligible).ToListAsync();

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
