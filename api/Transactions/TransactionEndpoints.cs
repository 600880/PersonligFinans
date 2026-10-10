using Microsoft.EntityFrameworkCore;
using PersonligFinans.Api.CategorizationRules;
using PersonligFinans.Api.Data;

namespace PersonligFinans.Api.Transactions;

public record CreateTransactionRequest(
    DateOnly? Date,
    string? Description,
    decimal? Amount,
    string? Reference,
    int? CategoryId);

public record ChangeCategoryRequest(int? CategoryId);

public record TransactionResponse(
    int Id,
    DateOnly Date,
    string Description,
    decimal Amount,
    string? Reference,
    int? CategoryId);

public record TransactionMonthResponse(int Year, int Month);

public static class TransactionEndpoints
{
    // numeric(12,2) holds at most 10 digits before the decimal point.
    private const decimal MaxAbsoluteAmount = 9_999_999_999.99m;

    private const int MinYear = 1900;
    private const int MaxYear = 2999;

    public static void MapTransactionEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api");

        api.MapGet("/transactions/months", async (AppDbContext db) =>
            await db.Transactions
                .Select(t => new { t.PostedDate.Year, t.PostedDate.Month })
                .Distinct()
                .OrderByDescending(m => m.Year)
                .ThenByDescending(m => m.Month)
                .Select(m => new TransactionMonthResponse(m.Year, m.Month))
                .ToListAsync());

        api.MapGet("/transactions", ListMonth);
        api.MapPost("/transactions", CreateTransaction);
        api.MapPut("/transactions/{id:int}/category", ChangeCategory);
    }

    // A month's Transactions, imported and manual, newest first with the id as a stable tie-break.
    private static async Task<IResult> ListMonth(int? year, int? month, AppDbContext db)
    {
        var errors = ValidateMonth(year, month);
        if (errors.Count > 0)
            return Results.ValidationProblem(errors);

        var first = new DateOnly(year!.Value, month!.Value, 1);
        var next = first.AddMonths(1);
        return Results.Ok(await db.Transactions
            .Where(t => t.PostedDate >= first && t.PostedDate < next)
            .OrderByDescending(t => t.PostedDate)
            .ThenByDescending(t => t.Id)
            .Select(t => ToResponse(t))
            .ToListAsync());
    }

    // The errors per field of a month given as a year and a month; empty when both are valid.
    internal static Dictionary<string, string[]> ValidateMonth(int? year, int? month)
    {
        var errors = ValidateYear(year);

        if (month is not (>= 1 and <= 12))
            errors["month"] = ["Month must be between 1 and 12."];

        return errors;
    }

    // The errors per field of a year; empty when it is valid.
    internal static Dictionary<string, string[]> ValidateYear(int? year)
    {
        var errors = new Dictionary<string, string[]>();

        if (year is not (>= MinYear and <= MaxYear))
            errors["year"] = [$"Year must be between {MinYear} and {MaxYear}."];

        return errors;
    }

    private static async Task<IResult> CreateTransaction(CreateTransactionRequest request, AppDbContext db)
    {
        var errors = new Dictionary<string, string[]>();
        void Fail(string field, string message) => errors[field] = [message];

        var description = request.Description?.Trim() ?? "";
        var reference = string.IsNullOrWhiteSpace(request.Reference) ? null : request.Reference.Trim();

        if (request.Date is null)
            Fail("date", "Date is required.");

        if (description.Length == 0)
            Fail("description", "Description is required.");
        else if (description.Length > AppDbContext.DescriptionMaxLength)
            Fail("description", $"Description must be at most {AppDbContext.DescriptionMaxLength} characters.");

        if (request.Amount is not { } amount || amount == 0)
            Fail("amount", "Amount must be non-zero.");
        else if (Math.Abs(amount) > MaxAbsoluteAmount)
            Fail("amount", "Amount is too large.");
        else if (amount != Math.Round(amount, 2))
            Fail("amount", "Amount can have at most 2 decimal places.");

        if (reference?.Length > AppDbContext.ReferenceMaxLength)
            Fail("reference", $"Reference must be at most {AppDbContext.ReferenceMaxLength} characters.");

        if (request.CategoryId is null)
            Fail("categoryId", "Category is required.");
        else if (!await db.Categories.AnyAsync(c => c.Id == request.CategoryId))
            Fail("categoryId", "Category does not exist.");

        if (errors.Count > 0)
            return Results.ValidationProblem(errors);

        var transaction = new Transaction
        {
            PostedDate = request.Date!.Value,
            Description = description,
            Amount = request.Amount!.Value,
            Reference = reference,
            CategoryId = request.CategoryId,
        };
        db.Transactions.Add(transaction);
        await db.SaveChangesAsync();

        return Results.Created($"/api/transactions/{transaction.Id}", ToResponse(transaction));
    }

    // Categorizes one Transaction manually: an imported Transaction loses its rule link, so rules never
    // change it again. Never creates, changes or deletes a Categorization Rule.
    private static async Task<IResult> ChangeCategory(int id, ChangeCategoryRequest request, AppDbContext db)
    {
        await using var dbTransaction = await Categorizer.BeginManualCategorizationAsync(db);

        var transaction = await db.Transactions.FindAsync(id);
        if (transaction is null)
            return Results.NotFound();

        // A Category is required, so a Transaction can never be made Uncategorized.
        if (request.CategoryId is null)
            return CategoryProblem("Category is required.");
        if (!await db.Categories.AnyAsync(c => c.Id == request.CategoryId))
            return CategoryProblem("Category does not exist.");

        transaction.CategoryId = request.CategoryId;
        transaction.CategorizationRuleId = null;
        await db.SaveChangesAsync();
        await dbTransaction.CommitAsync();

        return Results.Ok(ToResponse(transaction));
    }

    private static IResult CategoryProblem(string message) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { ["categoryId"] = [message] });

    private static TransactionResponse ToResponse(Transaction transaction) =>
        new(
            transaction.Id,
            transaction.PostedDate,
            transaction.Description,
            transaction.Amount,
            transaction.Reference,
            transaction.CategoryId);
}
