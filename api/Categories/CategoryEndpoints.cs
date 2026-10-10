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

        api.MapPut("/{id:int}", EditCategory);
    }

    private static async Task<IResult> EditCategory(int id, CategoryRequest request, AppDbContext db)
    {
        var category = await db.Categories.FindAsync(id);
        if (category is null)
            return Results.NotFound();

        var (name, description, errors) = await Validate(request, db, editedCategory: category);
        if (errors.Count > 0)
            return Results.ValidationProblem(errors);

        category.Name = name;
        category.Description = description;

        if (!await SaveCategory(db))
            return await NameAlreadyExists(db, name);

        return Results.Ok(new CategoryResponse(
            category.Id,
            category.Name,
            category.Description,
            category.BuiltIn,
            await db.Transactions.CountAsync(t => t.CategoryId == id),
            await db.CategorizationRules.CountAsync(r => r.CategoryId == id)));
    }

    // The trimmed name and description, and the validation errors keyed on the request's fields.
    // When editing, the edited Category's own name doesn't count as a duplicate, and a Built-in
    // Category must keep its name exactly.
    private static async Task<(string Name, string Description, Dictionary<string, string[]> Errors)> Validate(
        CategoryRequest request, AppDbContext db, Category? editedCategory)
    {
        var errors = new Dictionary<string, string[]>();
        void Fail(string field, string message) => errors[field] = [message];

        var name = request.Name?.Trim() ?? "";
        var description = request.Description?.Trim() ?? "";

        if (name.Length == 0)
            Fail("name", "Name is required.");
        else if (editedCategory is { BuiltIn: true } && name != editedCategory.Name)
            Fail("name", "A Built-in Category can't be renamed.");
        else if (name.Length > AppDbContext.CategoryNameMaxLength)
            Fail("name", $"Name must be at most {AppDbContext.CategoryNameMaxLength} characters.");
        else if (await FindByName(db, name, editedCategory?.Id) is { } existing)
            Fail("name", AlreadyExists(existing));

        if (description.Length == 0)
            Fail("description", "Description is required.");
        else if (description.Length > AppDbContext.CategoryDescriptionMaxLength)
            Fail("description", $"Description must be at most {AppDbContext.CategoryDescriptionMaxLength} characters.");

        return (name, description, errors);
    }

    // Returns false when the name was taken concurrently, between validation and now.
    private static async Task<bool> SaveCategory(AppDbContext db)
    {
        try
        {
            await db.SaveChangesAsync();
            return true;
        }
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            return false;
        }
    }

    private static async Task<IResult> NameAlreadyExists(AppDbContext db, string name) =>
        Results.ValidationProblem(new Dictionary<string, string[]>
        {
            ["name"] = [AlreadyExists(await FindByName(db, name, editedCategoryId: null) ?? name)],
        });

    // Names are unique ignoring case, so this finds the name as it was originally typed.
    private static Task<string?> FindByName(AppDbContext db, string name, int? editedCategoryId) =>
        db.Categories
            .Where(c => c.Id != editedCategoryId && c.Name.ToLower() == name.ToLower())
            .Select(c => c.Name)
            .FirstOrDefaultAsync();

    private static string AlreadyExists(string name) => $"A category named '{name}' already exists.";
}
