using PersonligFinans.Api.Data;

namespace PersonligFinans.Api.BankStatements;

public record BankStatementResponse(
    int Id,
    string AccountNumber,
    DateOnly PeriodStart,
    DateOnly PeriodEnd,
    int TransactionCount);

public static class BankStatementEndpoints
{
    public static void MapBankStatementEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api");

        // A JSON API without cookie auth, so there is no forgery risk to guard the upload against.
        api.MapPost("/bank-statements", ImportBankStatement).DisableAntiforgery();
    }

    private static async Task<IResult> ImportBankStatement(IFormFile file, AppDbContext db)
    {
        IReadOnlyList<StatementLine> lines;
        await using (var pdf = file.OpenReadStream())
            lines = StatementPdfReader.Read(pdf);

        var result = StatementParser.Parse(lines);
        if (result.Statement is not { } parsed)
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["file"] = [result.Error!] });

        var statement = new BankStatement
        {
            AccountNumber = parsed.AccountNumber,
            PeriodStart = parsed.PeriodStart,
            PeriodEnd = parsed.PeriodEnd,
            OpeningBalance = parsed.OpeningBalance,
            ClosingBalance = parsed.ClosingBalance,
            ImportedAt = DateTimeOffset.UtcNow,
        };
        statement.Transactions.AddRange(parsed.Rows.Select(row => new Transaction
        {
            PostedDate = row.BookedDate,
            Description = row.Description,
            Amount = row.Amount,
        }));

        // One SaveChanges is one database transaction: the statement and all its rows, or nothing.
        db.BankStatements.Add(statement);
        await db.SaveChangesAsync();

        return Results.Created(
            $"/api/bank-statements/{statement.Id}",
            new BankStatementResponse(
                statement.Id,
                statement.AccountNumber,
                statement.PeriodStart,
                statement.PeriodEnd,
                statement.Transactions.Count));
    }
}
