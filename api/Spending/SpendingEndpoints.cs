using Microsoft.EntityFrameworkCore;
using PersonligFinans.Api.Data;
using PersonligFinans.Api.Transactions;

namespace PersonligFinans.Api.Spending;

// CategoryId is null for the Uncategorized slice.
public record SpendingSliceResponse(int? CategoryId, decimal Amount);

public record SpendingResponse(decimal Total, IReadOnlyList<SpendingSliceResponse> Slices);

public static class SpendingEndpoints
{
    // Moving money between the user's own accounts is not Spending.
    private const string TransfersCategoryName = "Transfers";

    public static void MapSpendingEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/spending", SpendingOfMonth);
    }

    // A month's Spending: one slice per Category with negative Amounts, and one for Uncategorized
    // when it has any, largest first.
    private static async Task<IResult> SpendingOfMonth(int? year, int? month, AppDbContext db)
    {
        var errors = TransactionEndpoints.ValidateMonth(year, month);
        if (errors.Count > 0)
            return Results.ValidationProblem(errors);

        var first = new DateOnly(year!.Value, month!.Value, 1);
        var next = first.AddMonths(1);
        var slices = await db.Transactions
            .Where(t => t.PostedDate >= first && t.PostedDate < next && t.Amount < 0)
            .Where(t => t.Category == null || t.Category.Name != TransfersCategoryName)
            .GroupBy(t => t.CategoryId)
            .Select(g => new { CategoryId = g.Key, Amount = -g.Sum(t => t.Amount) })
            .OrderByDescending(s => s.Amount)
            .Select(s => new SpendingSliceResponse(s.CategoryId, s.Amount))
            .ToListAsync();

        return Results.Ok(new SpendingResponse(slices.Sum(s => s.Amount), slices));
    }
}
