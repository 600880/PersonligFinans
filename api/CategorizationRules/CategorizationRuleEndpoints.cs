using Microsoft.EntityFrameworkCore;
using Npgsql;
using PersonligFinans.Api.Data;

namespace PersonligFinans.Api.CategorizationRules;

public record CategorizationRuleRequest(string? Keyword, int? CategoryId);

public record CategorizationRuleResponse(int Id, string Keyword, int CategoryId);

public record CreatedCategorizationRuleResponse(int Id, string Keyword, int CategoryId, int TransactionsChanged);

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
                .Select(r => new CategorizationRuleResponse(r.Id, r.Keyword, r.CategoryId))
                .ToListAsync());

        api.MapPost("/", AddRule);
    }

    private static async Task<IResult> AddRule(CategorizationRuleRequest request, AppDbContext db)
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
        else if (await FindByKeyword(db, keyword) is { } existing)
            Fail("keyword", AlreadyExists(existing));

        if (request.CategoryId is null)
            Fail("categoryId", "Category is required.");
        else if (!await db.Categories.AnyAsync(c => c.Id == request.CategoryId))
            Fail("categoryId", "Category does not exist.");

        if (errors.Count > 0)
            return Results.ValidationProblem(errors);

        var rule = new CategorizationRule
        {
            Keyword = keyword,
            CategoryId = request.CategoryId!.Value,
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.CategorizationRules.Add(rule);
        var transactionsChanged = await Categorizer.RematchAsync(db);

        // One SaveChanges is one database transaction: the rule and its effect, or nothing.
        try
        {
            await db.SaveChangesAsync();
        }
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            // The same keyword was added concurrently, between the check above and now.
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["keyword"] = [AlreadyExists(await FindByKeyword(db, keyword) ?? keyword)],
            });
        }

        return Results.Created(
            $"/api/categorization-rules/{rule.Id}",
            new CreatedCategorizationRuleResponse(rule.Id, rule.Keyword, rule.CategoryId, transactionsChanged));
    }

    // Keywords are unique ignoring case, so this finds the keyword as it was originally typed.
    private static Task<string?> FindByKeyword(AppDbContext db, string keyword) =>
        db.CategorizationRules
            .Where(r => r.Keyword.ToLower() == keyword.ToLower())
            .Select(r => r.Keyword)
            .FirstOrDefaultAsync();

    private static string AlreadyExists(string keyword) => $"A rule for '{keyword}' already exists.";
}
