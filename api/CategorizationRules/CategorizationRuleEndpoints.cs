using Microsoft.EntityFrameworkCore;
using Npgsql;
using PersonligFinans.Api.Data;

namespace PersonligFinans.Api.CategorizationRules;

public record CategorizationRuleRequest(string? Keyword, int? CategoryId);

public record CategorizationRuleResponse(int Id, string Keyword, int CategoryId, bool AiGenerated);

public record SavedCategorizationRuleResponse(
    int Id, string Keyword, int CategoryId, bool AiGenerated, int TransactionsChanged);

public record DeletedCategorizationRuleResponse(int TransactionsChanged);

public static class CategorizationRuleEndpoints
{
    // A one-letter keyword would match nearly every description.
    private const int KeywordMinLength = 2;

    public static void MapCategorizationRuleEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api/categorization-rules");

        api.MapGet("/", async (AppDbContext db) =>
            await db.CategorizationRules
                .OrderBy(r => r.Keyword)
                .Select(r => new CategorizationRuleResponse(r.Id, r.Keyword, r.CategoryId, r.AiGenerated))
                .ToListAsync());

        api.MapPost("/", AddRule);
        api.MapPut("/{id:int}", EditRule);
        api.MapDelete("/{id:int}", DeleteRule);
    }

    private static async Task<IResult> AddRule(CategorizationRuleRequest request, AppDbContext db)
    {
        var (keyword, errors) = await Validate(request, db, editedRuleId: null);
        if (errors.Count > 0)
            return Results.ValidationProblem(errors);

        var rule = new CategorizationRule
        {
            Keyword = keyword,
            CategoryId = request.CategoryId!.Value,
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.CategorizationRules.Add(rule);

        if (await SaveRuleChange(db) is not { } transactionsChanged)
            return await KeywordAlreadyExists(db, keyword);

        return Results.Created($"/api/categorization-rules/{rule.Id}", Saved(rule, transactionsChanged));
    }

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

        if (await SaveRuleChange(db) is not { } transactionsChanged)
            return await KeywordAlreadyExists(db, keyword);

        return Results.Ok(Saved(rule, transactionsChanged));
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

    private static SavedCategorizationRuleResponse Saved(CategorizationRule rule, int transactionsChanged) =>
        new(rule.Id, rule.Keyword, rule.CategoryId, rule.AiGenerated, transactionsChanged);

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
        else if (keyword.Length < KeywordMinLength)
            Fail("keyword", $"Keyword must be at least {KeywordMinLength} characters.");
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

    // Keywords are unique ignoring case, so this finds the keyword as it was originally typed.
    private static Task<string?> FindByKeyword(AppDbContext db, string keyword, int? editedRuleId) =>
        db.CategorizationRules
            .Where(r => r.Id != editedRuleId && r.Keyword.ToLower() == keyword.ToLower())
            .Select(r => r.Keyword)
            .FirstOrDefaultAsync();

    private static string AlreadyExists(string keyword) => $"A rule for '{keyword}' already exists.";
}
