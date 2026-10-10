using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using PersonligFinans.Api.CategorizationRules;
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

// How a Category in use is deleted, from the query string: its Categorization Rules and
// Transactions move to a replacement Category, or its rules are deleted. Giving both is refused.
public record CategoryDeletion(int? ReplacementCategoryId, bool? DeleteRules);

public record DeletedCategoryResponse(int TransactionsChanged);

public static class CategoryEndpoints
{
    private static readonly StringComparer ByNorwegianName =
        StringComparer.Create(CultureInfo.GetCultureInfo("nb-NO"), ignoreCase: true);

    public static void MapCategoryEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api/categories");

        // The Built-in Categories first, in their own order, then the rest by name in the Norwegian
        // alphabet, ignoring case. The client sorts an added or renamed Category the same way.
        api.MapGet("/", async (AppDbContext db) =>
            (await db.Categories
                .Select(c => new CategoryResponse(
                    c.Id,
                    c.Name,
                    c.Description,
                    c.Colour,
                    c.BuiltIn,
                    db.Transactions.Count(t => t.CategoryId == c.Id),
                    db.CategorizationRules.Count(r => r.CategoryId == c.Id)))
                .ToListAsync())
            .OrderBy(c => c.BuiltIn ? Array.IndexOf(SeedCategories.BuiltInOrder, c.Name) : SeedCategories.BuiltInOrder.Length)
            .ThenBy(c => c.Name, ByNorwegianName)
            .ToList());

        api.MapPost("/", AddCategory);
        api.MapPut("/{id:int}", EditCategory);
        api.MapDelete("/{id:int}", DeleteCategory);
    }

    // A new Category is never built-in, and nothing uses it yet.
    private static async Task<IResult> AddCategory(CategoryRequest request, AppDbContext db)
    {
        var (name, description, errors) = await Validate(request, db, editedCategory: null);
        if (errors.Count > 0)
            return Results.ValidationProblem(errors);

        var category = new Category
        {
            Name = name,
            Description = description,
            Colour = CategoryColours.Next(await db.Categories.Select(c => c.Colour).ToListAsync()),
        };
        db.Categories.Add(category);

        if (!await SaveCategory(db))
            return await NameAlreadyExists(db, name);

        return Results.Created(
            $"/api/categories/{category.Id}",
            new CategoryResponse(category.Id, category.Name, category.Description, category.Colour, category.BuiltIn, 0, 0));
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
            category.Colour,
            category.BuiltIn,
            await db.Transactions.CountAsync(t => t.CategoryId == id),
            await db.CategorizationRules.CountAsync(r => r.CategoryId == id)));
    }

    // Deletes a Category. One in use needs a choice: a replacement Category, which its
    // Categorization Rules and Transactions move to first, or deleteRules, which deletes its rules
    // and leaves its Transactions to the remaining rules, or Uncategorized. One nothing uses needs
    // neither. Built-in Categories can't be deleted. Returns how many Transactions changed Category.
    private static async Task<IResult> DeleteCategory(int id, [AsParameters] CategoryDeletion deletion, AppDbContext db)
    {
        var deleteRules = deletion.DeleteRules == true;

        // A rule change, under its lock, so no rule can take the Category between the check and the
        // delete, and the move or rule deletion and its re-match happen in one database transaction.
        await using var transaction = await Categorizer.BeginRuleChangeAsync(db);

        var category = await db.Categories.FindAsync(id);
        if (category is null)
            return Results.NotFound();
        if (category.BuiltIn)
            return CategoryProblem($"{category.Name} is a Built-in Category, so it can't be deleted.");

        if (deletion.ReplacementCategoryId is not null && deleteRules)
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["deleteRules"] = ["Choose either a replacement Category or to delete its rules, not both."],
            });

        var transactionsChanged = 0;
        if (deletion.ReplacementCategoryId is { } replacementId)
        {
            if (replacementId == id)
                return ReplacementProblem("The replacement must be another Category.");
            if (!await db.Categories.AnyAsync(c => c.Id == replacementId))
                return ReplacementProblem("The replacement Category does not exist.");

            transactionsChanged = await Categorizer.MoveToReplacementAsync(db, id, replacementId);
        }
        else if (deleteRules)
            transactionsChanged = await Categorizer.DeleteRulesAndUncategorizeAsync(db, id);
        else if (await db.Transactions.AnyAsync(t => t.CategoryId == id) ||
            await db.CategorizationRules.AnyAsync(r => r.CategoryId == id))
            return InUse(category);

        db.Categories.Remove(category);
        try
        {
            await db.SaveChangesAsync();
        }
        // A Transaction took the Category concurrently, between the check or move and now.
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: PostgresErrorCodes.ForeignKeyViolation })
        {
            return InUse(category);
        }
        await transaction.CommitAsync();

        return Results.Ok(new DeletedCategoryResponse(transactionsChanged));
    }

    private static IResult InUse(Category category) =>
        CategoryProblem($"{category.Name} is in use, so it can't be deleted.");

    private static IResult CategoryProblem(string message) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { ["category"] = [message] });

    private static IResult ReplacementProblem(string message) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { ["replacementCategoryId"] = [message] });

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
