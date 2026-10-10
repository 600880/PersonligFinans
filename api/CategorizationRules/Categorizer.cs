using System.Linq.Expressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using PersonligFinans.Api.Data;

namespace PersonligFinans.Api.CategorizationRules;

// Owns what a Categorization Rule means. The invariant it keeps: every rule-eligible Transaction
// (imported, and not categorized manually) has the Category of its best-matching current rule.
// When no rule matches, it is in Other if it is AI-placed in Other, and Uncategorized otherwise.
public static class Categorizer
{
    // A one-letter keyword would match nearly every description.
    public const int KeywordMinLength = 2;

    // "Other" is a decision, never something a rule falls back on, so no AI-generated rule gets it.
    // The LLM places single Transactions in it instead (AI-placed in Other).
    public const string OtherCategoryName = "Other";

    // Imported, and not categorized manually: categorized by a rule, Uncategorized, or AI-placed in Other.
    private static readonly Expression<Func<Transaction, bool>> IsRuleEligible =
        t => t.BankStatementId != null &&
            (t.CategorizationRuleId != null || t.CategoryId == null || t.AiPlacedInOther);

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

    // Opens the database transaction for categorizing a Transaction manually, and takes a lock that
    // conflicts with the rule-change lock but not with itself. A rule change re-matches the
    // rule-eligible Transactions it loaded, so a Category chosen manually and saved in between would
    // be overwritten; instead this waits for a rule change in progress, and a rule change waits for
    // this. Load the Transaction after this, so it is read as the last rule change left it.
    public static async Task<IDbContextTransaction> BeginManualCategorizationAsync(AppDbContext db)
    {
        var transaction = await db.Database.BeginTransactionAsync();
        await db.Database.ExecuteSqlRawAsync("LOCK TABLE categorization_rules IN SHARE MODE");
        return transaction;
    }

    // Adds an AI-generated rule for each proposal, one at a time in order, and returns all rules,
    // including the added ones. Each proposal is checked against the rules as they stand at its
    // turn, including the ones added before it, and dropped unless:
    // - no rule matches its row's description;
    // - its Category exists and is not "Other";
    // - its keyword, trimmed and lowercased, is within the length limits, appears in the row's
    //   description ignoring case, and is unique ignoring case;
    // - it would change the Category of nothing that has one: no rule-eligible Transaction, and none
    //   of the descriptions about to be imported. It may only categorize what is Uncategorized or
    //   AI-placed in Other, since no rule holds either.
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
        var categoryIdByName = await db.Categories
            .Where(c => c.Name != OtherCategoryName)
            .ToDictionaryAsync(c => c.Name, c => c.Id);
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
        var otherId = await OtherCategoryIdAsync(db);

        var eligible = await db.Transactions.Where(IsRuleEligible).ToListAsync();

        var changed = 0;
        foreach (var transaction in eligible)
        {
            var rule = ChooseRule(transaction.Description, rules);
            var categoryId = rule?.CategoryId ?? (transaction.AiPlacedInOther ? otherId : null);
            if (transaction.CategoryId != categoryId)
                changed++;
            transaction.CategoryId = categoryId;
            transaction.CategorizationRule = rule;
            if (rule is null)
                transaction.CategorizationRuleId = null;
        }

        return changed;
    }

    // Makes each of the given Transactions that is still Uncategorized AI-placed in Other. During
    // import, call it with the rows the LLM was asked about, after the AI-generated rules are added
    // and the import is re-matched, so it takes the rows the LLM declined or whose proposal was dropped.
    public static async Task PlaceInOtherAsync(AppDbContext db, IEnumerable<Transaction> transactions)
    {
        var otherId = await OtherCategoryIdAsync(db);
        foreach (var transaction in transactions.Where(t => t.CategoryId is null))
        {
            transaction.CategoryId = otherId;
            transaction.AiPlacedInOther = true;
        }
    }

    // Found by name, which is safe because Other is a Built-in Category and can't be renamed.
    private static Task<int> OtherCategoryIdAsync(AppDbContext db) =>
        db.Categories.Where(c => c.Name == OtherCategoryName).Select(c => c.Id).SingleAsync();
}
