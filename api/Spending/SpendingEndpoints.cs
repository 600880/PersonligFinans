using Microsoft.EntityFrameworkCore;
using PersonligFinans.Api.Data;
using PersonligFinans.Api.Transactions;

namespace PersonligFinans.Api.Spending;

// CategoryId is null for the Uncategorized slice.
public record SpendingSliceResponse(int? CategoryId, decimal Amount);

public record SpendingResponse(decimal Total, IReadOnlyList<SpendingSliceResponse> Slices);

public static class SpendingEndpoints
{
    // Moving money between the user's own accounts is not Spending, unless the user asks to include it.
    private const string TransfersCategoryName = "Transfers";

    public static void MapSpendingEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/spending", SpendingOfPeriod);
    }

    // A Period's Spending: one slice per Category with negative Amounts, and one for Uncategorized
    // when it has any, largest first. The Period is a year with a quarter, a year with a month, or a
    // year alone for the whole year. The Transfers Category is left out unless includeTransfers is set.
    private static async Task<IResult> SpendingOfPeriod(
        int? year, int? quarter, int? month, AppDbContext db, bool includeTransfers = false)
    {
        var errors = ValidatePeriod(year, quarter, month);
        if (errors.Count > 0)
            return Results.ValidationProblem(errors);

        var (first, next) = Bounds(year!.Value, quarter, month);
        var slices = await db.Transactions
            .Where(t => t.PostedDate >= first && t.PostedDate < next && t.Amount < 0)
            .Where(t => includeTransfers || t.Category == null || t.Category.Name != TransfersCategoryName)
            .GroupBy(t => t.CategoryId)
            .Select(g => new { CategoryId = g.Key, Amount = -g.Sum(t => t.Amount) })
            .OrderByDescending(s => s.Amount)
            .Select(s => new SpendingSliceResponse(s.CategoryId, s.Amount))
            .ToListAsync();

        return Results.Ok(new SpendingResponse(slices.Sum(s => s.Amount), slices));
    }

    // The errors per field of a Period; empty when it is valid.
    private static Dictionary<string, string[]> ValidatePeriod(int? year, int? quarter, int? month)
    {
        var errors = month is null
            ? TransactionEndpoints.ValidateYear(year)
            : TransactionEndpoints.ValidateMonth(year, month);

        if (quarter is not null && month is not null)
            errors["quarter"] = ["Give either a quarter or a month, not both."];
        else if (quarter is not (null or (>= 1 and <= 4)))
            errors["quarter"] = ["Quarter must be between 1 and 4."];

        return errors;
    }

    // From the first day of the Period up to, but not including, the first day of the next.
    private static (DateOnly First, DateOnly Next) Bounds(int year, int? quarter, int? month)
    {
        if (month is not null)
        {
            var firstOfMonth = new DateOnly(year, month.Value, 1);
            return (firstOfMonth, firstOfMonth.AddMonths(1));
        }
        if (quarter is not null)
        {
            var firstOfQuarter = new DateOnly(year, 3 * (quarter.Value - 1) + 1, 1);
            return (firstOfQuarter, firstOfQuarter.AddMonths(3));
        }
        var firstOfYear = new DateOnly(year, 1, 1);
        return (firstOfYear, firstOfYear.AddYears(1));
    }
}
