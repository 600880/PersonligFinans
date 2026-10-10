using Microsoft.EntityFrameworkCore;
using Npgsql;
using PersonligFinans.Api.CategorizationRules;
using PersonligFinans.Api.Data;

namespace PersonligFinans.Api.Categories;

// TransactionCount and RuleCount are how many Transactions and Categorization Rules have the Category.
public record CategoryResponse(
    int Id,
    string Name,
    string Description,
    bool BuiltIn,
    int TransactionCount,
    int RuleCount);

public record DeletedCategoryResponse(int TransactionsChanged);

public static class CategoryEndpoints
{
    public static void MapCategoryEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api/categories");

        api.MapGet("/", async (AppDbContext db) =>
            await db.Categories
                .OrderBy(c => c.Name)
                .Select(c => new CategoryResponse(
                    c.Id,
                    c.Name,
                    c.Description,
                    c.BuiltIn,
                    db.Transactions.Count(t => t.CategoryId == c.Id),
                    db.CategorizationRules.Count(r => r.CategoryId == c.Id)))
                .ToListAsync());

        api.MapDelete("/{id:int}", DeleteCategory);
    }

    // Deletes a Category that nothing uses. Built-in Categories can't be deleted.
    private static async Task<IResult> DeleteCategory(int id, AppDbContext db)
    {
        // Under the rule-change lock, so no rule can take the Category between the check and the delete.
        await using var transaction = await Categorizer.BeginRuleChangeAsync(db);

        var category = await db.Categories.FindAsync(id);
        if (category is null)
            return Results.NotFound();
        if (category.BuiltIn)
            return CategoryProblem($"{category.Name} is a Built-in Category, so it can't be deleted.");
        if (await db.Transactions.AnyAsync(t => t.CategoryId == id) ||
            await db.CategorizationRules.AnyAsync(r => r.CategoryId == id))
            return InUse(category);

        db.Categories.Remove(category);
        try
        {
            await db.SaveChangesAsync();
        }
        // A Transaction took the Category concurrently, between the check and now.
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: PostgresErrorCodes.ForeignKeyViolation })
        {
            return InUse(category);
        }
        await transaction.CommitAsync();

        // Nothing used the Category, so no Transaction changed.
        return Results.Ok(new DeletedCategoryResponse(TransactionsChanged: 0));
    }

    private static IResult InUse(Category category) =>
        CategoryProblem($"{category.Name} is in use, so it can't be deleted.");

    private static IResult CategoryProblem(string message) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { ["category"] = [message] });
}
