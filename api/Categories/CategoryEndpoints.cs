using Microsoft.EntityFrameworkCore;
using Npgsql;
using PersonligFinans.Api.Data;

namespace PersonligFinans.Api.Categories;

public record CategoryRequest(string? Name, string? Description);

// TransactionCount and RuleCount are how many Transactions and Categorization Rules have the Category.
public record CategoryResponse(
    int Id,
    string Name,
    string Description,
    string Colour,
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
                    c.Colour,
                    c.BuiltIn,
                    db.Transactions.Count(t => t.CategoryId == c.Id),
                    db.CategorizationRules.Count(r => r.CategoryId == c.Id)))
                .ToListAsync());

        api.MapPost("/", AddCategory);
    }

    // A new Category is never built-in, and nothing uses it yet.
    private static async Task<IResult> AddCategory(CategoryRequest request, AppDbContext db)
    {
        var (name, description, errors) = await Validate(request, db);
        if (errors.Count > 0)
            return Results.ValidationProblem(errors);

        var category = new Category
        {
            Name = name,
            Description = description,
            Colour = CategoryColours.Next(await db.Categories.Select(c => c.Colour).ToListAsync()),
        };
        db.Categories.Add(category);

        try
        {
            await db.SaveChangesAsync();
        }
        // The name was taken concurrently, between validation and now.
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["name"] = [AlreadyExists(await FindByName(db, name) ?? name)],
            });
        }

        return Results.Created(
            $"/api/categories/{category.Id}",
            new CategoryResponse(category.Id, category.Name, category.Description, category.Colour, category.BuiltIn, 0, 0));
    }

    // The trimmed name and description, and the validation errors keyed on the request's fields.
    private static async Task<(string Name, string Description, Dictionary<string, string[]> Errors)> Validate(
        CategoryRequest request, AppDbContext db)
    {
        var errors = new Dictionary<string, string[]>();
        void Fail(string field, string message) => errors[field] = [message];

        var name = request.Name?.Trim() ?? "";
        var description = request.Description?.Trim() ?? "";

        if (name.Length == 0)
            Fail("name", "Name is required.");
        else if (name.Length > AppDbContext.CategoryNameMaxLength)
            Fail("name", $"Name must be at most {AppDbContext.CategoryNameMaxLength} characters.");
        else if (await FindByName(db, name) is { } existing)
            Fail("name", AlreadyExists(existing));

        if (description.Length == 0)
            Fail("description", "Description is required.");
        else if (description.Length > AppDbContext.CategoryDescriptionMaxLength)
            Fail("description", $"Description must be at most {AppDbContext.CategoryDescriptionMaxLength} characters.");

        return (name, description, errors);
    }

    // Names are unique ignoring case, so this finds the name as it was originally typed.
    private static Task<string?> FindByName(AppDbContext db, string name) =>
        db.Categories
            .Where(c => c.Name.ToLower() == name.ToLower())
            .Select(c => c.Name)
            .FirstOrDefaultAsync();

    private static string AlreadyExists(string name) => $"A Category named '{name}' already exists.";
}
