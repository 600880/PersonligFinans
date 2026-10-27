using Microsoft.EntityFrameworkCore;
using Npgsql;
using PersonligFinans.Api.Data;

namespace PersonligFinans.Api.CategorizationRules;

public record CategorizationRuleRequest(string? Keyword, int? CategoryId);

// IsNew: added by the most recent Upload that imported a Bank Statement. TransactionCount: how many
// Transactions the rule categorizes, so not the Locked ones nor those a longer keyword won.
public record CategorizationRuleResponse(
    int Id, string Keyword, int CategoryId, bool AiGenerated, bool IsNew, int TransactionCount);

public record SavedCategorizationRuleResponse(
    int Id, string Keyword, int CategoryId, bool AiGenerated, bool IsNew, int TransactionCount, int TransactionsChanged);

public record DeletedCategorizationRuleResponse(int TransactionsChanged);

public record DeletedCategorizationRulesResponse(int RulesDeleted);

// What a rule change would do, without doing it. ChangedCount: how many Transactions would change
// Category. LockedCount: how many Locked Transactions contain the keyword, which it leaves as they
// are. Changes: up to Categorizer.PreviewedChangesMax of the Transactions that would change, newest
// posted date first.
public record RulePreviewResponse(int ChangedCount, int LockedCount, List<RulePreviewChange> Changes);

// A Transaction a rule change would change, from one Category to another; null means Uncategorized.
public record RulePreviewChange(
    int Id, DateOnly Date, string Description, decimal Amount, int? FromCategoryId, int? ToCategoryId);

public static class CategorizationRuleEndpoints
{
    public static void MapCategorizationRuleEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api/categorization-rules");

        api.MapGet("/", async (AppDbContext db) =>
        {
            var latestUploadId = await LatestUploadId(db);
            var rules = await db.CategorizationRules.OrderBy(r => r.Keyword).ToListAsync();
            var transactionCounts = await Categorizer.TransactionCountsByRuleAsync(db);
            return rules.Select(r => new CategorizationRuleResponse(
                r.Id, r.Keyword, r.CategoryId, r.AiGenerated, r.UploadId != null && r.UploadId == latestUploadId,
                transactionCounts.GetValueOrDefault(r.Id)));
        });

        api.MapPost("/", AddRule);
        // A preview is a dry run of a rule change: the same request, to the change's path followed by
        // /preview. It validates exactly as the change does, but changes nothing and takes no lock.
        api.MapPost("/preview", PreviewAddingRule);
        api.MapPut("/{id:int}", EditRule);
        api.MapPut("/{id:int}/preview", PreviewEditingRule);
        api.MapDelete("/{id:int}", DeleteRule);
        api.MapDelete("/{id:int}/preview", PreviewDeletingRule);
        // A DELETE rather than a POST: it takes no JSON, and another site's page can't send a DELETE
        // without a preflight, which the API never grants.
        api.MapDelete("/", DeleteAllRules);
    }

    private static async Task<IResult> AddRule(CategorizationRuleRequest request, AppDbContext db)
    {
        var (keyword, errors) = await Validate(request, db, editedRuleId: null);
        if (errors.Count > 0)
            return Results.ValidationProblem(errors);

        var rule = new CategorizationRule
        {
            UserId = db.OwnerOfNewRows,
            Keyword = keyword,
            CategoryId = request.CategoryId!.Value,
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.CategorizationRules.Add(rule);

        if (await SaveRuleChange(db) is not { } transactionsChanged)
            return await KeywordAlreadyExists(db, keyword);

        return Results.Created(
            $"/api/categorization-rules/{rule.Id}", await Saved(db, rule, latestUploadId: null, transactionsChanged));
    }

    // What AddRule would do with the request: the saved rules, with the new one among them, as it
    // would be created now.
    private static async Task<IResult> PreviewAddingRule(CategorizationRuleRequest request, AppDbContext db)
    {
        var (keyword, errors) = await Validate(request, db, editedRuleId: null);
        if (errors.Count > 0)
            return Results.ValidationProblem(errors);

        var rules = await db.CategorizationRules.AsNoTracking().ToListAsync<ICategorizationRule>();
        // Created after every saved rule, so its id is greater than theirs.
        rules.Add(new ProposedRule(int.MaxValue, keyword, request.CategoryId!.Value, DateTimeOffset.UtcNow));

        return Results.Ok(Previewed(await Categorizer.PreviewAsync(db, rules, keyword)));
    }

    private static RulePreviewResponse Previewed<TRule>(RuleChangePreview<TRule> preview)
        where TRule : class, ICategorizationRule =>
        new(preview.ChangedCount, preview.LockedCount,
            preview.Changes
                .Select(c => new RulePreviewChange(
                    c.Transaction.Id, c.Transaction.PostedDate, c.Transaction.Description, c.Transaction.Amount,
                    c.Transaction.CategoryId, c.CategoryId))
                .ToList());

    private static async Task<IResult> EditRule(int id, CategorizationRuleRequest request, AppDbContext db)
    {
        var rule = await db.CategorizationRules.FindAsync(id);
        if (rule is null)
            return Results.NotFound();

        var (keyword, errors) = await Validate(request, db, editedRuleId: id);
        if (errors.Count > 0)
            return Results.ValidationProblem(errors);

        rule.Keyword = keyword;
        rule.CategoryId = request.CategoryId!.Value;
        // Saving an AI-generated rule, even unchanged, makes it the user's own.
        rule.AiGenerated = false;

        if (await SaveRuleChange(db) is not { } transactionsChanged)
            return await KeywordAlreadyExists(db, keyword);

        return Results.Ok(await Saved(db, rule, await LatestUploadId(db), transactionsChanged));
    }

    // What EditRule would do with the request: the saved rules, with the edited one as the edit
    // would leave it. It keeps its id and when it was created, which break ties as before.
    private static async Task<IResult> PreviewEditingRule(int id, CategorizationRuleRequest request, AppDbContext db)
    {
        var rules = await db.CategorizationRules.AsNoTracking().ToListAsync<ICategorizationRule>();
        if (rules.SingleOrDefault(r => r.Id == id) is not { } rule)
            return Results.NotFound();

        var (keyword, errors) = await Validate(request, db, editedRuleId: id);
        if (errors.Count > 0)
            return Results.ValidationProblem(errors);

        rules.Remove(rule);
        rules.Add(new ProposedRule(rule.Id, keyword, request.CategoryId!.Value, rule.CreatedAt));

        return Results.Ok(Previewed(await Categorizer.PreviewAsync(db, rules, keyword)));
    }

    private static async Task<IResult> DeleteRule(int id, AppDbContext db)
    {
        var rule = await db.CategorizationRules.FindAsync(id);
        if (rule is null)
            return Results.NotFound();

        db.CategorizationRules.Remove(rule);
        var transactionsChanged = await Categorizer.SaveRuleChangeAsync(db);

        return Results.Ok(new DeletedCategorizationRuleResponse(transactionsChanged));
    }

    // What DeleteRule would do: the saved rules, without the deleted one. Deleting brings in no
    // keyword, so no Locked Transactions are counted.
    private static async Task<IResult> PreviewDeletingRule(int id, AppDbContext db)
    {
        var rules = await db.CategorizationRules.AsNoTracking().ToListAsync<ICategorizationRule>();
        if (rules.RemoveAll(r => r.Id == id) == 0)
            return Results.NotFound();

        return Results.Ok(Previewed(await Categorizer.PreviewAsync(db, rules, keyword: null)));
    }

    // Deletes every rule of the User, seeded ones included, and re-matches against none, so every
    // imported Transaction that isn't Locked becomes Uncategorized. Categories stay.
    private static async Task<IResult> DeleteAllRules(AppDbContext db)
    {
        // The rules are loaded under the rule-change lock, so none added meanwhile by another
        // browser, as by an import, outlives the delete.
        await using var transaction = await Categorizer.BeginRuleChangeAsync(db);
        var rules = await db.CategorizationRules.ToListAsync();
        db.CategorizationRules.RemoveRange(rules);
        await Categorizer.RematchAsync(db);
        await db.SaveChangesAsync();
        await transaction.CommitAsync();

        return Results.Ok(new DeletedCategorizationRulesResponse(rules.Count));
    }

    private static async Task<SavedCategorizationRuleResponse> Saved(
        AppDbContext db, CategorizationRule rule, Guid? latestUploadId, int transactionsChanged) =>
        new(rule.Id, rule.Keyword, rule.CategoryId, rule.AiGenerated,
            rule.UploadId is not null && rule.UploadId == latestUploadId,
            await Categorizer.TransactionCountAsync(db, rule.Id), transactionsChanged);

    // The most recent Upload that imported a Bank Statement, or null before any import. Kept even
    // when its Bank Statements are deleted.
    private static Task<Guid?> LatestUploadId(AppDbContext db) =>
        db.LatestUploads.Select(l => (Guid?)l.UploadId).SingleOrDefaultAsync();

    // The trimmed keyword, and the validation errors keyed on the request's fields. When editing,
    // the edited rule's own keyword doesn't count as a duplicate.
    private static async Task<(string Keyword, Dictionary<string, string[]> Errors)> Validate(
        CategorizationRuleRequest request, AppDbContext db, int? editedRuleId)
    {
        var errors = new Dictionary<string, string[]>();
        void Fail(string field, string message) => errors[field] = [message];

        var keyword = request.Keyword?.Trim() ?? "";

        if (keyword.Length == 0)
            Fail("keyword", "Keyword is required.");
        else if (keyword.Length < Categorizer.KeywordMinLength)
            Fail("keyword", $"Keyword must be at least {Categorizer.KeywordMinLength} characters.");
        else if (keyword.Length > AppDbContext.KeywordMaxLength)
            Fail("keyword", $"Keyword must be at most {AppDbContext.KeywordMaxLength} characters.");
        else if (await FindByKeyword(db, keyword, editedRuleId) is { } existing)
            Fail("keyword", AlreadyExists(existing));

        if (request.CategoryId is null)
            Fail("categoryId", "Category is required.");
        else if (!await db.Categories.AnyAsync(c => c.Id == request.CategoryId))
            Fail("categoryId", "Category does not exist.");

        return (keyword, errors);
    }

    // Saves the rule change with its re-match: both, or nothing. Returns null when the keyword was
    // taken concurrently, between validation and now.
    private static async Task<int?> SaveRuleChange(AppDbContext db)
    {
        try
        {
            return await Categorizer.SaveRuleChangeAsync(db);
        }
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            return null;
        }
    }

    private static async Task<IResult> KeywordAlreadyExists(AppDbContext db, string keyword) =>
        Results.ValidationProblem(new Dictionary<string, string[]>
        {
            ["keyword"] = [AlreadyExists(await FindByKeyword(db, keyword, editedRuleId: null) ?? keyword)],
        });

    // Keywords are unique among the User's rules ignoring case, so this finds the keyword as it was
    // originally typed.
    private static Task<string?> FindByKeyword(AppDbContext db, string keyword, int? editedRuleId) =>
        db.CategorizationRules
            .Where(r => r.Id != editedRuleId && r.Keyword.ToLower() == keyword.ToLower())
            .Select(r => r.Keyword)
            .FirstOrDefaultAsync();

    private static string AlreadyExists(string keyword) => $"A rule for '{keyword}' already exists.";
}
