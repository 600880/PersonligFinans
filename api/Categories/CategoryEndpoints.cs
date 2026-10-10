using Microsoft.EntityFrameworkCore;
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
    }
}
