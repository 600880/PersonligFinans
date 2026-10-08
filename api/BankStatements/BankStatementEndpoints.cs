using Microsoft.EntityFrameworkCore;
using Npgsql;
using PersonligFinans.Api.CategorizationRules;
using PersonligFinans.Api.Data;

namespace PersonligFinans.Api.BankStatements;

public record BankStatementResponse(
    int Id,
    string AccountNumber,
    DateOnly PeriodStart,
    DateOnly PeriodEnd,
    int TransactionCount,
    int UncategorizedCount);

public static class BankStatementEndpoints
{
    private const long MaxFileBytes = 10 * 1024 * 1024;

    public static void MapBankStatementEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api");

        // A JSON API without cookie auth, so there is no forgery risk to guard the upload against.
        api.MapPost("/bank-statements", ImportBankStatement).DisableAntiforgery();
    }

    // The form is read by hand rather than bound to an IFormFile, so that a missing or oversized
    // file gets the same validation problem as every other rejected upload.
    private static async Task<IResult> ImportBankStatement(HttpRequest request, AppDbContext db)
    {
        IFormFile? file;
        try
        {
            file = request.HasFormContentType ? (await request.ReadFormAsync()).Files.GetFile("file") : null;
        }
        catch (BadHttpRequestException e) when (e.StatusCode == StatusCodes.Status413PayloadTooLarge)
        {
            // Kestrel's own request size limit (30 MB) was hit while reading the form.
            return FileProblem("The file is larger than 10 MB.");
        }

        if (file is null || file.Length == 0)
            return FileProblem("Choose a PDF file to upload.");
        if (file.Length > MaxFileBytes)
            return FileProblem("The file is larger than 10 MB.");

        IReadOnlyList<StatementLine> lines;
        await using (var pdf = file.OpenReadStream())
        {
            if (!await StartsLikePdf(pdf))
                return FileProblem("The file is not a PDF.");

            try
            {
                lines = StatementPdfReader.Read(pdf);
            }
            catch (Exception)
            {
                return FileProblem("The PDF could not be read. It may be damaged.");
            }
        }

        var result = StatementParser.Parse(lines);
        if (result.Statement is not { } parsed)
            return FileProblem(result.Error!);

        if (await db.BankStatements.AnyAsync(s =>
                s.AccountNumber == parsed.AccountNumber &&
                s.PeriodStart == parsed.PeriodStart &&
                s.PeriodEnd == parsed.PeriodEnd))
            return AlreadyImported(parsed);

        var statement = new BankStatement
        {
            AccountNumber = parsed.AccountNumber,
            PeriodStart = parsed.PeriodStart,
            PeriodEnd = parsed.PeriodEnd,
            OpeningBalance = parsed.OpeningBalance,
            ClosingBalance = parsed.ClosingBalance,
            ImportedAt = DateTimeOffset.UtcNow,
        };
        var rules = await db.CategorizationRules.ToListAsync();
        statement.Transactions.AddRange(parsed.Rows.Select(row =>
        {
            var rule = Categorizer.ChooseRule(row.Description, rules);
            return new Transaction
            {
                PostedDate = row.BookedDate,
                Description = row.Description,
                Amount = row.Amount,
                CategoryId = rule?.CategoryId,
                CategorizationRule = rule,
            };
        }));

        // One SaveChanges is one database transaction: the statement and all its rows, or nothing.
        db.BankStatements.Add(statement);
        try
        {
            await db.SaveChangesAsync();
        }
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            // The same Bank Statement was imported concurrently, between the check above and now.
            return AlreadyImported(parsed);
        }

        return Results.Created(
            $"/api/bank-statements/{statement.Id}",
            new BankStatementResponse(
                statement.Id,
                statement.AccountNumber,
                statement.PeriodStart,
                statement.PeriodEnd,
                statement.Transactions.Count,
                statement.Transactions.Count(t => t.CategoryId is null)));
    }

    private static IResult FileProblem(string message) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { ["file"] = [message] });

    private static IResult AlreadyImported(ParsedStatement statement) =>
        Results.Problem(
            detail: $"Statement for {statement.AccountNumber}, " +
                $"{statement.PeriodStart:dd.MM.yyyy}–{statement.PeriodEnd:dd.MM.yyyy} has already been imported.",
            statusCode: StatusCodes.Status409Conflict);

    // Every PDF starts with "%PDF-". The stream is rewound for the reader afterwards.
    private static async Task<bool> StartsLikePdf(Stream file)
    {
        var header = new byte[5];
        var read = await file.ReadAtLeastAsync(header, header.Length, throwOnEndOfStream: false);
        file.Position = 0;
        return read == header.Length && header.AsSpan().SequenceEqual("%PDF-"u8);
    }
}
