using Microsoft.EntityFrameworkCore;
using PersonligFinans.Api.Data;

namespace PersonligFinans.Api.Transactions;

public record CreateTransactionRequest(
    DateOnly? Date,
    string? Description,
    decimal? Amount,
    string? Reference,
    int? CategoryId);

public record TransactionResponse(
    int Id,
    DateOnly Date,
    string Description,
    decimal Amount,
    string? Reference,
    int? CategoryId);

public record CategoryResponse(int Id, string Name);

public static class TransactionEndpoints
{
    // numeric(12,2) holds at most 10 digits before the decimal point.
    private const decimal MaxAbsoluteAmount = 9_999_999_999.99m;

    public static void MapTransactionEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api");

        api.MapGet("/categories", async (AppDbContext db) =>
            await db.Categories
                .OrderBy(c => c.Name)
                .Select(c => new CategoryResponse(c.Id, c.Name))
                .ToListAsync());

        api.MapPost("/transactions", CreateTransaction);
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

        return Results.Created(
            $"/api/transactions/{transaction.Id}",
            new TransactionResponse(
                transaction.Id,
                transaction.PostedDate,
                transaction.Description,
                transaction.Amount,
                transaction.Reference,
                transaction.CategoryId));
    }
}
