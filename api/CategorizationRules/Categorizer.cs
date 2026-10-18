using System.Linq.Expressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using PersonligFinans.Api.Data;

namespace PersonligFinans.Api.CategorizationRules;

// Owns what a Categorization Rule means. The invariant it keeps: every rule-eligible Transaction
// (imported, and not categorized manually) has the Category of its best-matching current rule, or
// is Uncategorized when no rule matches.
public static class Categorizer
{
    // A one-letter keyword would match nearly every description.
    public const int KeywordMinLength = 2;

    // Payment Channels: services that carry payments for many unrelated merchants or people, so their
    // name says nothing about what was bought and no AI-generated rule is keyed on one. Lowercase,
    // as keywords are.
    public static readonly IReadOnlySet<string> PaymentChannels = new HashSet<string> { "vipps", "klarna", "paypal" };

    // Imported, and not categorized manually: categorized by a rule, or Uncategorized.
    private static readonly Expression<Func<Transaction, bool>> IsRuleEligible =
        t => t.BankStatementId != null && (t.CategorizationRuleId != null || t.CategoryId == null);

    // The same test, for Transactions changed in memory but not yet saved.
    private static readonly Func<Transaction, bool> IsRuleEligibleInMemory = IsRuleEligible.Compile();

    // Locked: the rules will never change its Category. Manually entered, or categorized manually.
    public static bool IsLocked(Transaction transaction) => !IsRuleEligibleInMemory(transaction);

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
    // with itself, so whoever changes rules waits for the previous change to commit first. It locks
    // the whole table, so one User's rule change also waits for another's.
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

    // Adds an AI-generated rule for each proposal, one at a time in order, as added by the given
    // Upload, and returns all rules, including the added ones. Each proposal is checked against the rules as they stand at its
    // turn, including the ones added before it, and dropped unless:
    // - no rule matches its row's description;
    // - its Category exists;
    // - its keyword, trimmed and lowercased, is within the length limits, is not a Payment Channel,
    //   appears in the row's description ignoring case, and is unique among the User's rules
    //   ignoring case;
    // - it would change the Category of nothing that has one: no rule-eligible Transaction, and none
    //   of the descriptions about to be imported. It may only categorize what is Uncategorized.
    // Each added rule is saved at once, so that the uniqueness check is made by the database,
    // comparing keywords exactly as its unique index does. Call it inside the database transaction
    // of a rule change, so the checks see every rule and the rules are undone with the change.
    public static async Task<List<CategorizationRule>> AddAiGeneratedRulesAsync(
        AppDbContext db,
        Guid uploadId,
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
                PaymentChannels.Contains(keyword) ||
                !description.Contains(keyword, StringComparison.OrdinalIgnoreCase))
                continue;

            var rule = new CategorizationRule
            {
                UserId = db.CurrentUserId,
                Keyword = keyword,
                CategoryId = categoryId,
                CreatedAt = now,
                AiGenerated = true,
                UploadId = uploadId,
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
    // added, changed or deleted but not yet saved, and returns how many changed Category. A
    // Transaction counts as rule-eligible as saved or as changed in db but not yet saved, so one
    // just made Uncategorized is re-matched too.
    public static async Task<int> RematchAsync(AppDbContext db) => (await RematchedAsync(db)).Count;

    // Re-matches like RematchAsync, and returns the Transactions that changed Category.
    private static async Task<List<Transaction>> RematchedAsync(AppDbContext db)
    {
        await db.CategorizationRules.LoadAsync();
        var rules = db.CategorizationRules.Local.ToList();

        var eligible = await db.Transactions.Where(IsRuleEligible).ToListAsync();
        eligible = eligible.Union(db.Transactions.Local.Where(IsRuleEligibleInMemory)).ToList();

        var changed = new List<Transaction>();
        foreach (var transaction in eligible)
        {
            var rule = ChooseRule(transaction.Description, rules);
            var categoryId = rule?.CategoryId;
            if (transaction.CategoryId != categoryId)
                changed.Add(transaction);
            transaction.CategoryId = categoryId;
            transaction.CategorizationRule = rule;
            if (rule is null)
                transaction.CategorizationRuleId = null;
        }

        return changed;
    }

    // Moves a Category's Categorization Rules and Transactions to the replacement Category, then
    // re-matches, and returns how many Transactions changed Category, counting each once. Each
    // Transaction keeps how it was categorized: a manual one stays manual, and one categorized by a
    // rule follows its rule. Call it inside the database transaction of a rule change; nothing is
    // saved.
    public static async Task<int> MoveToReplacementAsync(AppDbContext db, int categoryId, int replacementId)
    {
        foreach (var rule in await RulesOf(db, categoryId))
            rule.CategoryId = replacementId;

        var moved = await db.Transactions.Where(t => t.CategoryId == categoryId).ToListAsync();
        foreach (var transaction in moved)
            transaction.CategoryId = replacementId;

        // Every moved Transaction changed Category.
        return await RematchCountingOnceAsync(db, alreadyChanged: moved);
    }

    // Deletes a Category's Categorization Rules and makes its Transactions Uncategorized, then
    // re-matches, and returns how many Transactions changed Category, counting each once. Its
    // imported Transactions, including those categorized manually, are then matched against the
    // remaining rules like any rule change: a rule that still matches takes them, and the rest stay
    // Uncategorized. Its manually-entered Transactions stay Uncategorized, since rules never apply
    // to them. Call it inside the database transaction of a rule change; nothing is saved.
    public static async Task<int> DeleteRulesAndUncategorizeAsync(AppDbContext db, int categoryId)
    {
        db.CategorizationRules.RemoveRange(await RulesOf(db, categoryId));

        var uncategorized = await db.Transactions.Where(t => t.CategoryId == categoryId).ToListAsync();
        foreach (var transaction in uncategorized)
        {
            transaction.CategoryId = null;
            transaction.CategorizationRuleId = null;
        }

        // Every one of its Transactions changed Category, whether the re-match gives it another or
        // leaves it Uncategorized.
        return await RematchCountingOnceAsync(db, alreadyChanged: uncategorized);
    }

    // Re-matches, and returns how many Transactions changed Category: those already changed, plus
    // those the re-match changes that weren't among them, so none is counted twice.
    private static async Task<int> RematchCountingOnceAsync(AppDbContext db, List<Transaction> alreadyChanged)
    {
        var alreadyChangedSet = alreadyChanged.ToHashSet();
        var rematched = await RematchedAsync(db);
        return alreadyChanged.Count + rematched.Count(t => !alreadyChangedSet.Contains(t));
    }

    private static Task<List<CategorizationRule>> RulesOf(AppDbContext db, int categoryId) =>
        db.CategorizationRules.Where(r => r.CategoryId == categoryId).ToListAsync();
}
