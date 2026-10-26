using Microsoft.EntityFrameworkCore;
using PersonligFinans.Api.Data;
using PersonligFinans.Api.Transactions;

namespace PersonligFinans.Api.Spending;

// CategoryId is null for the Uncategorized slice.
public record SpendingSliceResponse(int? CategoryId, decimal Amount);

public record SpendingResponse(decimal Total, IReadOnlyList<SpendingSliceResponse> Slices);

// One month of a Span's Spending: one slice per group whose Amounts that month don't net to zero,
// largest first, never Savings, negative when the group nets the other way. Beside it, what the month
// put aside in Savings and received in Income, negative when its Category's Amounts that month net the
// other way, and null when they net to zero. The client nets them over the Periods of its trend.
public record MonthlySpendingResponse(
    int Year,
    int Month,
    IReadOnlyList<SpendingSliceResponse> Slices,
    SpendingSliceResponse? Savings,
    SpendingSliceResponse? Income);

public static class SpendingEndpoints
{
    // Moving money between the user's own accounts is not Spending, unless the user asks the Period's
    // Spending to include it. A Span's monthly Spending has it beside instead.
    private const string SavingsCategoryName = "Savings";

    // Money received is never Spending, even when the Income Category has negative Amounts.
    private const string IncomeCategoryName = "Income";

    public static void MapSpendingEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/spending", SpendingOfPeriod);
        app.MapGet("/api/spending/monthly", MonthlySpendingOfSpan);
    }

    // A Period's Spending: one slice per group with Spending in it, its Amounts over the whole Period
    // netted together, largest first. The Period is a year with a quarter, a year with a month, or a
    // year alone for the whole year.
    private static async Task<IResult> SpendingOfPeriod(
        int? year, int? quarter, int? month, AppDbContext db, bool includeSavings = false)
    {
        var errors = ValidatePeriod(year, quarter, month);
        if (errors.Count > 0)
            return Results.ValidationProblem(errors);

        var (first, next) = Bounds(year!.Value, quarter, month);
        var slices = await SpendingTransactions(db, first, next, includeSavings)
            .GroupBy(t => t.CategoryId)
            .Select(g => new { CategoryId = g.Key, Amount = -g.Sum(t => t.Amount) })
            .Where(s => s.Amount > 0)
            .OrderByDescending(s => s.Amount)
            .Select(s => new SpendingSliceResponse(s.CategoryId, s.Amount))
            .ToListAsync();

        return Results.Ok(new SpendingResponse(slices.Sum(s => s.Amount), slices));
    }

    // A Span's Spending month by month: one entry per month from From to To, both included and in
    // order, with no slices for a month whose groups all net to zero, and its Savings and Income
    // beside them. The client groups the months into the points of its trend and nets them
    // there, so those points match the Spending of their Periods.
    private static async Task<IResult> MonthlySpendingOfSpan(
        int? fromYear, int? fromMonth, int? toYear, int? toMonth, AppDbContext db)
    {
        var errors = ValidateSpan(fromYear, fromMonth, toYear, toMonth);
        if (errors.Count > 0)
            return Results.ValidationProblem(errors);

        var from = new DateOnly(fromYear!.Value, fromMonth!.Value, 1);
        var to = new DateOnly(toYear!.Value, toMonth!.Value, 1);
        var slices = await MonthlySlices(db, from, to.AddMonths(1)).ToListAsync();
        var besides = await MonthlyBesides(db, from, to.AddMonths(1)).ToListAsync();

        var months = new List<MonthlySpendingResponse>();
        for (var month = from; month <= to; month = month.AddMonths(1))
        {
            var inMonth = besides.Where(b => b.Year == month.Year && b.Month == month.Month).ToList();
            months.Add(new MonthlySpendingResponse(
                month.Year,
                month.Month,
                slices
                    .Where(s => s.Year == month.Year && s.Month == month.Month)
                    .OrderByDescending(s => s.Amount)
                    .Select(s => new SpendingSliceResponse(s.CategoryId, s.Amount))
                    .ToList(),
                inMonth
                    .Where(b => b.CategoryName == SavingsCategoryName && b.Net != 0)
                    .Select(b => new SpendingSliceResponse(b.CategoryId, -b.Net))
                    .SingleOrDefault(),
                inMonth
                    .Where(b => b.CategoryName == IncomeCategoryName && b.Net != 0)
                    .Select(b => new SpendingSliceResponse(b.CategoryId, b.Net))
                    .SingleOrDefault()));
        }
        return Results.Ok(months);
    }

    // The Amounts of the Savings and the Income Category in each month from the first day up to, but
    // not including, the next, netted together.
    private static IQueryable<MonthBeside> MonthlyBesides(AppDbContext db, DateOnly first, DateOnly next) =>
        db.Transactions
            .Where(t => t.PostedDate >= first && t.PostedDate < next)
            .Where(t => t.Category!.Name == SavingsCategoryName || t.Category.Name == IncomeCategoryName)
            .GroupBy(t => new { t.PostedDate.Year, t.PostedDate.Month, t.CategoryId, t.Category!.Name })
            .Select(g => new MonthBeside
            {
                Year = g.Key.Year,
                Month = g.Key.Month,
                CategoryId = g.Key.CategoryId!.Value,
                CategoryName = g.Key.Name,
                Net = g.Sum(t => t.Amount),
            });

    // The Transactions from the first day up to, but not including, the next that can be Spending:
    // never Income, and Savings only when includeSavings is set.
    private static IQueryable<Transaction> SpendingTransactions(
        AppDbContext db, DateOnly first, DateOnly next, bool includeSavings) =>
        db.Transactions
            .Where(t => t.PostedDate >= first && t.PostedDate < next)
            .Where(t => t.Category == null || t.Category.Name != IncomeCategoryName)
            .Where(t => includeSavings || t.Category == null || t.Category.Name != SavingsCategoryName);

    // Each group's Amounts in each month from the first day up to, but not including, the next, netted
    // together as what it cost: negative when it nets the other way, with no slice when it nets to
    // zero. Never Income or Savings.
    private static IQueryable<MonthSlice> MonthlySlices(AppDbContext db, DateOnly first, DateOnly next) =>
        SpendingTransactions(db, first, next, includeSavings: false)
            .GroupBy(t => new { t.PostedDate.Year, t.PostedDate.Month, t.CategoryId })
            .Select(g => new MonthSlice
            {
                Year = g.Key.Year,
                Month = g.Key.Month,
                CategoryId = g.Key.CategoryId,
                Amount = -g.Sum(t => t.Amount),
            })
            .Where(s => s.Amount != 0);

    // Built with an initializer rather than a constructor so that EF can filter and group on it.
    private class MonthSlice
    {
        public int Year { get; init; }
        public int Month { get; init; }
        public int? CategoryId { get; init; }
        public decimal Amount { get; init; }
    }

    // Built with an initializer, like MonthSlice.
    private class MonthBeside
    {
        public int Year { get; init; }
        public int Month { get; init; }
        public int CategoryId { get; init; }
        public required string CategoryName { get; init; }
        public decimal Net { get; init; }
    }

    // The errors per field of a Span; empty when it is valid. To must be at least one month after From.
    private static Dictionary<string, string[]> ValidateSpan(int? fromYear, int? fromMonth, int? toYear, int? toMonth)
    {
        // ValidateMonth keys its errors "year" and "month", which become e.g. "fromYear" and "toMonth".
        var errors = new Dictionary<string, string[]>();
        void AddMonthErrors(string end, int? year, int? month)
        {
            foreach (var (field, messages) in TransactionEndpoints.ValidateMonth(year, month))
                errors[end + char.ToUpperInvariant(field[0]) + field[1..]] = messages;
        }
        AddMonthErrors("from", fromYear, fromMonth);
        AddMonthErrors("to", toYear, toMonth);

        if (errors.Count == 0 && toYear * 12 + toMonth <= fromYear * 12 + fromMonth)
            errors["toMonth"] = ["To must be at least one month after From."];

        return errors;
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
