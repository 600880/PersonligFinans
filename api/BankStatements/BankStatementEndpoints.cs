using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using PersonligFinans.Api.AiRequests;
using PersonligFinans.Api.CategorizationRules;
using PersonligFinans.Api.Data;
using PersonligFinans.Api.Users;

namespace PersonligFinans.Api.BankStatements;

public record BankStatementResponse(
    int Id,
    string AccountNumber,
    DateOnly PeriodStart,
    DateOnly PeriodEnd,
    int TransactionCount,
    int UncategorizedCount,
    bool AiCategorizationUnavailable,
    bool DailyAiLimitReached);

public static class BankStatementEndpoints
{
    private const long MaxFileBytes = 10 * 1024 * 1024;

    public static void MapBankStatementEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api");

        api.MapPost("/bank-statements", ImportBankStatement).RequireAntiforgeryToken();
    }

    // The form is read by hand rather than bound to an IFormFile, so that a missing or oversized
    // file gets the same validation problem as every other rejected upload.
    // The rule generator is optional: without one, unmatched rows simply stay Uncategorized.
    // Proposing rules for a Bank Statement with unmatched rows is one AI request. Past the Daily AI
    // limit the rule generator isn't asked, and its unmatched rows stay Uncategorized too.
    // The form's optional "uploadId" names the Upload the file belongs to; without one, the file is
    // an Upload of its own.
    private static async Task<IResult> ImportBankStatement(
        HttpRequest request,
        AppDbContext db,
        AiRequestLedger ledger,
        [FromServices] IRuleGenerator? ruleGenerator,
        ILoggerFactory loggerFactory)
    {
        IFormFile? file;
        string? uploadIdField;
        try
        {
            var form = request.HasFormContentType ? await request.ReadFormAsync() : null;
            file = form?.Files.GetFile("file");
            uploadIdField = form?["uploadId"].FirstOrDefault();
        }
        catch (BadHttpRequestException e) when (e.StatusCode == StatusCodes.Status413PayloadTooLarge)
        {
            // Kestrel's own request size limit (30 MB) was hit while reading the form.
            return FileProblem("The file is larger than 10 MB.");
        }

        var uploadId = Guid.NewGuid();
        if (!string.IsNullOrEmpty(uploadIdField) && !Guid.TryParse(uploadIdField, out uploadId))
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["uploadId"] = ["Upload id is not valid."] });

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

        // Asked before the database transaction is opened, since the rule generator may be a slow
        // network call and must not hold the lock while it runs.
        var (proposals, aiCategorizationUnavailable, dailyAiLimitReached) =
            await ProposeRules(parsed.Rows, db, ledger, ruleGenerator);
        if (aiCategorizationUnavailable)
            loggerFactory.CreateLogger(typeof(BankStatementEndpoints)).LogWarning(
                "AI categorization was unavailable for a Bank Statement of {RowCount} rows; its unmatched rows stay Uncategorized.",
                parsed.Rows.Count);

        var statement = new BankStatement
        {
            UserId = db.CurrentUserId,
            AccountNumber = parsed.AccountNumber,
            PeriodStart = parsed.PeriodStart,
            PeriodEnd = parsed.PeriodEnd,
            OpeningBalance = parsed.OpeningBalance,
            ClosingBalance = parsed.ClosingBalance,
            ImportedAt = DateTimeOffset.UtcNow,
            UploadId = uploadId,
        };
        // The import may add rules, so it takes the rule-change lock: imports and rule changes run one
        // after another, and a rule change can't miss these rows while they are being categorized.
        await using var transaction = await Categorizer.BeginRuleChangeAsync(db);
        var rules = await Categorizer.AddAiGeneratedRulesAsync(db, uploadId, proposals, parsed.Rows.Select(row => row.Description));
        statement.Transactions.AddRange(parsed.Rows.Select(row =>
        {
            var rule = Categorizer.ChooseRule(row.Description, rules);
            return new Transaction
            {
                UserId = db.CurrentUserId,
                PostedDate = row.BookedDate,
                Description = row.Description,
                Amount = row.Amount,
                CategoryId = rule?.CategoryId,
                CategorizationRule = rule,
            };
        }));
        // New AI-generated rules may also match Uncategorized Transactions from earlier imports.
        await Categorizer.RematchAsync(db);

        // One database transaction: the statement, all its rows and the rules they brought, or nothing.
        db.BankStatements.Add(statement);
        try
        {
            await db.SaveChangesAsync();
            await transaction.CommitAsync();
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
                statement.Transactions.Count(t => t.CategoryId is null),
                aiCategorizationUnavailable,
                dailyAiLimitReached));
    }

    // The rule generator's proposals for the rows no current rule matches, in row order, each with
    // the description it was made for. Each distinct description and sign is asked about once, in one
    // AI request. There are none when there is no rule generator, every row is matched, the Daily AI
    // limit is reached, or the generator is unavailable; only the last two say so.
    private static async Task<(List<(string Description, RuleProposal Proposal)> Proposals, bool Unavailable, bool LimitReached)>
        ProposeRules(IReadOnlyList<StatementRow> rows, AppDbContext db, AiRequestLedger ledger, IRuleGenerator? ruleGenerator)
    {
        if (ruleGenerator is null)
            return ([], false, false);

        // Not tracked, so the rules loaded again under the lock are the current ones.
        var rules = await db.CategorizationRules.AsNoTracking().ToListAsync();
        var unmatched = rows
            .Where(row => Categorizer.ChooseRule(row.Description, rules) is null)
            .Select(row => ToUnmatchedRow(row.Description, row.Amount))
            .Distinct()
            .ToList();
        if (unmatched.Count == 0)
            return ([], false, false);

        // Read at each import, so an edited description reaches the next prompt.
        var categories = await db.Categories
            .OrderBy(c => c.Name)
            .Select(c => new CategoryChoice(c.Name, c.Description))
            .ToListAsync();
        if (!await ledger.TryTakeAsync())
            return ([], false, true);
        return await ruleGenerator.GenerateAsync(unmatched, categories) switch
        {
            RuleGeneration.Generated generated =>
                (unmatched
                    .Where(generated.Proposals.ContainsKey)
                    .Select(row => (row.Description, generated.Proposals[row]))
                    .ToList(), false, false),
            // Unavailable: the unmatched rows stay Uncategorized.
            _ => ([], true, false),
        };
    }

    // A row as the rule generator is asked about it.
    private static UnmatchedRow ToUnmatchedRow(string description, decimal amount) =>
        new(description, amount < 0 ? AmountSign.Negative : AmountSign.Positive);

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
