using System.Globalization;
using Microsoft.EntityFrameworkCore;
using PersonligFinans.Api.CategorizationRules;
using PersonligFinans.Api.Data;

namespace PersonligFinans.Api.Transactions;

public record CreateTransactionRequest(
    DateOnly? Date,
    string? Description,
    decimal? Amount,
    string? Note,
    int? CategoryId);

public record ChangeNoteRequest(string? Note);

public record ChangeCategoryRequest(int? CategoryId);

public record TransactionResponse(
    int Id,
    DateOnly Date,
    string Description,
    decimal Amount,
    string? Note,
    int? CategoryId,
    // Locked: the rules will never change its Category.
    bool Locked,
    bool Imported);

public record TransactionMonthResponse(int Year, int Month);

public record PossibleDuplicateResponse(int Id, DateOnly Date, string Description, decimal Amount);

public static class TransactionEndpoints
{
    // numeric(12,2) holds at most 10 digits before the decimal point.
    private const decimal MaxAbsoluteAmount = 9_999_999_999.99m;

    private const int MinYear = 1900;
    private const int MaxYear = 2999;

    // An imported Transaction is usually booked one to three days after the purchase it records.
    private const int PossibleDuplicateDays = 3;

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

        api.MapGet("/transactions", ListPeriod);
        api.MapGet("/transactions/possible-duplicates", ListPossibleDuplicates);
        api.MapPost("/transactions", CreateTransaction);
        api.MapPut("/transactions/{id:int}/category", ChangeCategory);
        api.MapPut("/transactions/{id:int}/note", ChangeNote);
        api.MapDelete("/transactions/{id:int}", DeleteTransaction);
    }

    // A month's Transactions, or a whole year's when no month is given, imported and manual, newest
    // first with the id as a stable tie-break.
    private static async Task<IResult> ListPeriod(int? year, int? month, AppDbContext db)
    {
        var errors = month is null ? ValidateYear(year) : ValidateMonth(year, month);
        if (errors.Count > 0)
            return Results.ValidationProblem(errors);

        // Validated first, so the dates are only built from a valid year and month. A whole year
        // starts on 1 January.
        var first = new DateOnly(year!.Value, month ?? 1, 1);
        var next = month is null ? first.AddYears(1) : first.AddMonths(1);
        return Results.Ok(await db.Transactions
            .Where(t => t.PostedDate >= first && t.PostedDate < next)
            .OrderByDescending(t => t.PostedDate)
            .ThenByDescending(t => t.Id)
            .Select(t => ToResponse(t))
            .ToListAsync());
    }

    // The Possible duplicates of a Transaction being entered by hand: every Transaction, imported or
    // manual, with exactly the same signed Amount and a posted date within three days of the given
    // date either way, both ends included, oldest first with the id as a stable tie-break. Only a
    // warning for the user: saving a Transaction never checks for them. The date and Amount are read
    // as text, so that a malformed one gets a validation problem rather than a framework error: the
    // date as YYYY-MM-DD and the Amount with a point for decimals.
    private static async Task<IResult> ListPossibleDuplicates(string? date, string? amount, AppDbContext db)
    {
        var errors = new Dictionary<string, string[]>();

        if (!DateOnly.TryParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var day)
            || day.Year is not (>= MinYear and <= MaxYear))
            errors["date"] = [$"Date must be a date between {MinYear} and {MaxYear}, as YYYY-MM-DD."];

        var amountError = decimal.TryParse(
            amount, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var value)
            ? AmountError(value)
            : "Amount must be a number.";
        if (amountError is not null)
            errors["amount"] = [amountError];

        if (errors.Count > 0)
            return Results.ValidationProblem(errors);

        var first = day.AddDays(-PossibleDuplicateDays);
        var last = day.AddDays(PossibleDuplicateDays);
        return Results.Ok(await db.Transactions
            .Where(t => t.Amount == value && t.PostedDate >= first && t.PostedDate <= last)
            .OrderBy(t => t.PostedDate)
            .ThenBy(t => t.Id)
            .Select(t => new PossibleDuplicateResponse(t.Id, t.PostedDate, t.Description, t.Amount))
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
        var note = NormalizeNote(request.Note);

        if (request.Date is null)
            Fail("date", "Date is required.");

        if (description.Length == 0)
            Fail("description", "Description is required.");
        else if (description.Length > AppDbContext.DescriptionMaxLength)
            Fail("description", $"Description must be at most {AppDbContext.DescriptionMaxLength} characters.");

        if (AmountError(request.Amount) is { } amountError)
            Fail("amount", amountError);

        if (note?.Length > AppDbContext.NoteMaxLength)
            Fail("note", $"Note must be at most {AppDbContext.NoteMaxLength} characters.");

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
            Note = note,
            CategoryId = request.CategoryId,
        };
        db.Transactions.Add(transaction);
        await db.SaveChangesAsync();

        return Results.Created($"/api/transactions/{transaction.Id}", ToResponse(transaction));
    }

    // Sets the Note on any Transaction — imported or manual. Blank and null both clear it.
    private static async Task<IResult> ChangeNote(int id, ChangeNoteRequest request, AppDbContext db)
    {
        var transaction = await db.Transactions.FindAsync(id);
        if (transaction is null)
            return Results.NotFound();

        var note = NormalizeNote(request.Note);
        if (note?.Length > AppDbContext.NoteMaxLength)
            return Results.ValidationProblem(
                new Dictionary<string, string[]> { ["note"] = [$"Note must be at most {AppDbContext.NoteMaxLength} characters."] });

        transaction.Note = note;
        await db.SaveChangesAsync();

        return Results.Ok(ToResponse(transaction));
    }

    // Why an Amount can't be a Transaction's, or null when it can.
    private static string? AmountError(decimal? amount)
    {
        if (amount is not { } value || value == 0)
            return "Amount must be non-zero.";
        if (Math.Abs(value) > MaxAbsoluteAmount)
            return "Amount is too large.";
        if (value != Math.Round(value, 2))
            return "Amount can have at most 2 decimal places.";
        return null;
    }

    private static string? NormalizeNote(string? raw) =>
        string.IsNullOrWhiteSpace(raw) ? null : raw.Trim();

    // Categorizes one Transaction manually: an imported Transaction loses its rule link, so rules
    // never change it again. Never creates, changes or deletes a Categorization Rule.
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

    // Deletes a manually-entered Transaction for good. An imported one can't be deleted, so every
    // imported Bank Statement stays whole and reconciled.
    private static async Task<IResult> DeleteTransaction(int id, AppDbContext db)
    {
        var transaction = await db.Transactions.FindAsync(id);
        if (transaction is null)
            return Results.NotFound();

        if (transaction.IsImported)
            return Results.Problem(
                detail: "Imported Transactions can't be deleted.",
                statusCode: StatusCodes.Status409Conflict);

        db.Transactions.Remove(transaction);
        await db.SaveChangesAsync();

        return Results.NoContent();
    }

    private static IResult CategoryProblem(string message) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { ["categoryId"] = [message] });

    private static TransactionResponse ToResponse(Transaction transaction) =>
        new(
            transaction.Id,
            transaction.PostedDate,
            transaction.Description,
            transaction.Amount,
            transaction.Note,
            transaction.CategoryId,
            Categorizer.IsLocked(transaction),
            transaction.IsImported);
}
