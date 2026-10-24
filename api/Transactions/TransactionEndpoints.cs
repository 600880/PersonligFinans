using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using PersonligFinans.Api.Bookmarks;
using PersonligFinans.Api.CategorizationRules;
using PersonligFinans.Api.Data;

namespace PersonligFinans.Api.Transactions;

// Bookmark is where to bookmark the new Transaction, or null to leave it not bookmarked.
public record CreateTransactionRequest(
    DateOnly? Date,
    string? Description,
    decimal? Amount,
    string? Note,
    int? CategoryId,
    FileBookmarkRequest? Bookmark);

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
    bool Imported,
    // Bookmarked: the User has put a Bookmark on it.
    bool Bookmarked,
    // HasReceipt: its Receipt was kept when it was saved from a Receipt scan.
    bool HasReceipt);

public record TransactionMonthResponse(int Year, int Month);

public record PossibleDuplicateResponse(int Id, DateOnly Date, string Description, decimal Amount);

public record DeletedTransactionsResponse(int TransactionsDeleted);

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
        // A DELETE rather than a POST: it takes no JSON, and another site's page can't send a DELETE
        // without a preflight, which the API never grants.
        api.MapDelete("/transactions", DeleteAllTransactions);
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
        return Results.Ok(await ListNewestFirst(db.Transactions.Where(t => t.PostedDate >= first && t.PostedDate < next), db));
    }

    // The Transactions as responses, newest first with the id as a stable tie-break, each saying
    // whether it is bookmarked and whether it has a Receipt, without loading the Receipt. Every list
    // of Transactions has this order and shape.
    internal static Task<List<TransactionResponse>> ListNewestFirst(IQueryable<Transaction> transactions, AppDbContext db) =>
        transactions
            .OrderByDescending(t => t.PostedDate)
            .ThenByDescending(t => t.Id)
            .Select(t => ToResponse(
                t, db.Bookmarks.Any(b => b.TransactionId == t.Id), db.Receipts.Any(r => r.TransactionId == t.Id)))
            .ToListAsync();

    // The Possible duplicates of a Transaction being entered by hand: every Transaction, imported or
    // manually-entered, with exactly the same signed Amount and a posted date within three days of the given
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
        var errors = await ValidateNew(request, db);
        if (errors.Count > 0)
            return Results.ValidationProblem(errors);

        return await SaveNew(request, receipt: null, db);
    }

    // The errors per field of a request to create a manually-entered Transaction; empty when it can
    // be saved. Shared by the JSON create and the create with a Receipt, so they never drift apart.
    internal static async Task<Dictionary<string, string[]>> ValidateNew(CreateTransactionRequest request, AppDbContext db)
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

        // Another visitor of the Guest, or another tab, may have deleted it since the form was shown.
        if (request.Bookmark?.FolderId is { } folderId && !await db.Folders.AnyAsync(f => f.Id == folderId))
            Fail("bookmark", "The folder no longer exists.");

        return errors;
    }

    // Saves the manually-entered Transaction of a request ValidateNew found no errors in, with its
    // Bookmark when the request asks for one and its Receipt when an image is given, and answers
    // Created with it.
    internal static async Task<IResult> SaveNew(CreateTransactionRequest request, byte[]? receipt, AppDbContext db)
    {
        var transaction = new Transaction
        {
            UserId = db.OwnerOfNewRows,
            PostedDate = request.Date!.Value,
            Description = request.Description!.Trim(),
            Amount = request.Amount!.Value,
            Note = NormalizeNote(request.Note),
            CategoryId = request.CategoryId,
        };
        db.Transactions.Add(transaction);

        // The Transaction, its Bookmark and its Receipt are saved together or not at all. The Bookmark
        // and the Receipt need the Transaction's id, so they are saved second.
        await using var saving = await db.Database.BeginTransactionAsync();
        try
        {
            await db.SaveChangesAsync();
            if (request.Bookmark is { } bookmark)
            {
                db.Bookmarks.Add(new Bookmark { UserId = db.OwnerOfNewRows, TransactionId = transaction.Id, FolderId = bookmark.FolderId });
                await BookmarkEndpoints.MakeLastUsedFolder(db, bookmark.FolderId);
            }
            if (receipt is not null)
                db.Receipts.Add(new Receipt { UserId = db.OwnerOfNewRows, TransactionId = transaction.Id, Image = receipt });
            await db.SaveChangesAsync();
            await saving.CommitAsync();
        }
        // A first last used folder recorded concurrently, between the lookup and now: saving again
        // finds that row and changes it instead.
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            await saving.RollbackAsync();
            db.ChangeTracker.Clear();
            return await SaveNew(request, receipt, db);
        }

        return Results.Created(
            $"/api/transactions/{transaction.Id}",
            ToResponse(transaction, bookmarked: request.Bookmark is not null, hasReceipt: receipt is not null));
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

        return Results.Ok(await ToResponseAsync(transaction, db));
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

        return Results.Ok(await ToResponseAsync(transaction, db));
    }

    // Deletes a manually-entered Transaction for good, and the database deletes its Bookmark and its
    // Receipt with it by cascade. An imported one can't be deleted, so every imported Bank Statement
    // stays whole and reconciled.
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

    // Deletes every Transaction of the User: the manually-entered ones, and every Bank Statement, since
    // an imported Transaction goes only with its whole Bank Statement. Each Bank Statement can then be
    // imported again. Bookmarks and Receipts go with their Transactions, while Folders, the last used
    // folder, Categories and Categorization Rules stay, the rules with their AI-generated and New marks.
    private static async Task<IResult> DeleteAllTransactions(AppDbContext db)
    {
        // Under the rule-change lock, so it can't interleave with an import from another browser,
        // whose Transactions would otherwise outlive the delete, or with a rule change re-matching them.
        await using var transaction = await Categorizer.BeginRuleChangeAsync(db);

        // The Transactions first, imported ones included, so the count is of exactly those deleted. The
        // database deletes their Bookmarks and Receipts by cascade.
        var transactionsDeleted = await db.Transactions.ExecuteDeleteAsync();
        await db.BankStatements.ExecuteDeleteAsync();
        await transaction.CommitAsync();

        return Results.Ok(new DeletedTransactionsResponse(transactionsDeleted));
    }

    private static IResult CategoryProblem(string message) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { ["categoryId"] = [message] });

    // The Transaction as a response, asking the database whether it is bookmarked and whether it has a
    // Receipt.
    private static async Task<TransactionResponse> ToResponseAsync(Transaction transaction, AppDbContext db) =>
        ToResponse(
            transaction,
            await db.Bookmarks.AnyAsync(b => b.TransactionId == transaction.Id),
            await db.Receipts.AnyAsync(r => r.TransactionId == transaction.Id));

    private static TransactionResponse ToResponse(Transaction transaction, bool bookmarked, bool hasReceipt) =>
        new(
            transaction.Id,
            transaction.PostedDate,
            transaction.Description,
            transaction.Amount,
            transaction.Note,
            transaction.CategoryId,
            Categorizer.IsLocked(transaction),
            transaction.IsImported,
            bookmarked,
            hasReceipt);
}
