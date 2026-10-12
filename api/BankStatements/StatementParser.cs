using System.Globalization;
using System.Text.RegularExpressions;

namespace PersonligFinans.Api.BankStatements;

// One visual line of a Bank Statement, split by column position: Text is the "Forklaring" column,
// Out / In the "Ut av konto" / "Inn på konto" amounts and BookedDate the "Bokført" DDMM value.
// Direction and dates come from layout, never from wording.
public record StatementLine(string Text, string? Out = null, string? In = null, string? BookedDate = null);

public record StatementRow(DateOnly BookedDate, string Description, decimal Amount);

public record ParsedStatement(
    string AccountNumber,
    DateOnly PeriodStart,
    DateOnly PeriodEnd,
    decimal OpeningBalance,
    decimal ClosingBalance,
    IReadOnlyList<StatementRow> Rows);

public record StatementParseResult(ParsedStatement? Statement, string? Error)
{
    public static StatementParseResult Fail(string error) => new(null, error);
}

// Parses a Sparebanken Norge account statement (kontoutskrift).
public static partial class StatementParser
{
    private static readonly CultureInfo Norwegian = CultureInfo.GetCultureInfo("nb-NO");

    [GeneratedRegex(@"Kontoutskrift nr\. \d+ for konto (?<account>\d{4}\.\d{2}\.\d{5}) i perioden (?<start>\d{2}\.\d{2}\.\d{4}) - (?<end>\d{2}\.\d{2}\.\d{4})")]
    private static partial Regex HeaderPattern();

    public static StatementParseResult Parse(IReadOnlyList<StatementLine> lines)
    {
        var header = lines.Select(l => HeaderPattern().Match(l.Text)).FirstOrDefault(m => m.Success);
        if (header is null)
            return StatementParseResult.Fail("The file is not a Sparebanken Norge Bank Statement.");

        var periodStart = ParseDate(header.Groups["start"].Value);
        var periodEnd = ParseDate(header.Groups["end"].Value);

        decimal? opening = null;
        decimal? closing = null;
        var rows = new List<StatementRow>();

        foreach (var line in JoinContinuationLines(lines))
        {
            if (line.Out is null && line.In is null)
                continue;

            if (line.Text.StartsWith("Saldo fra kontoutskrift"))
                opening = SignedAmount(line);
            else if (line.Text.StartsWith("Saldo i Deres favør"))
                closing = SignedAmount(line);
            else if (IsYearToDateSummary(line.Text) || IsPageCarry(line.Text))
                continue;
            else if (line.Text.Length > 0 && ResolveBookedDate(line.BookedDate, periodEnd) is { } bookedDate)
            {
                // A 0,00 row (e.g. a test payment) moves no money, and a Transaction is never zero.
                if (SignedAmount(line) is not 0 and var amount)
                    rows.Add(new StatementRow(bookedDate, DescriptionCleaner.Clean(line.Text), amount));
            }
            else
                return StatementParseResult.Fail($"Could not read the statement line \"{line.Text}\".");
        }

        if (opening is null)
            return StatementParseResult.Fail("The statement has no opening balance.");
        if (closing is null)
            return StatementParseResult.Fail("The statement has no closing balance.");

        var expectedClosing = opening.Value + rows.Sum(r => r.Amount);
        if (expectedClosing != closing.Value)
            return StatementParseResult.Fail(
                $"The statement's transactions don't add up: expected a closing balance of " +
                $"{expectedClosing.ToString("N2", Norwegian)} but the statement says {closing.Value.ToString("N2", Norwegian)}.");

        return new StatementParseResult(
            new ParsedStatement(
                header.Groups["account"].Value,
                periodStart,
                periodEnd,
                opening.Value,
                closing.Value,
                rows),
            null);
    }

    // The bank wraps long descriptions (e.g. a lone "1.0000" after "Kurs:"). A line with no amount
    // directly below a row continues that row's description; any other line without an amount is
    // page furniture (headers, footers, notices) and is skipped later.
    private static List<StatementLine> JoinContinuationLines(IReadOnlyList<StatementLine> lines)
    {
        var joined = new List<StatementLine>();
        foreach (var line in lines)
        {
            var previous = joined.LastOrDefault();
            if (line.Out is null && line.In is null && line.Text.Length > 0
                && previous is { BookedDate: not null } && (previous.Out ?? previous.In) is not null)
                joined[^1] = previous with { Text = $"{previous.Text} {line.Text}" };
            else
                joined.Add(line);
        }
        return joined;
    }

    // Totals for the year so far, printed under the closing balance. The amounts were already
    // booked as rows, so they are not transactions themselves.
    private static bool IsYearToDateSummary(string text) =>
        text.StartsWith("Betalte omkostninger") || text.StartsWith("Renter og provisjon bokført");

    // The running balance carried from the bottom of one page to the top of the next.
    private static bool IsPageCarry(string text) =>
        text.StartsWith("Overført til neste side") || text.StartsWith("Overført fra forrige side");

    private static decimal SignedAmount(StatementLine line) =>
        line.Out is not null ? -ParseAmount(line.Out) : ParseAmount(line.In!);

    // Norwegian format: "24.500,00".
    private static decimal ParseAmount(string amount) =>
        decimal.Parse(amount.Replace(".", "").Replace(',', '.'), CultureInfo.InvariantCulture);

    private static DateOnly ParseDate(string date) =>
        DateOnly.ParseExact(date, "dd.MM.yyyy", CultureInfo.InvariantCulture);

    // Booked dates are printed as DDMM; the year comes from the statement period.
    // Null when missing or not a real date.
    private static DateOnly? ResolveBookedDate(string? ddmm, DateOnly periodEnd)
    {
        if (ddmm is not { Length: 4 } || !ddmm.All(char.IsAsciiDigit))
            return null;

        var day = int.Parse(ddmm[..2]);
        var month = int.Parse(ddmm[2..]);
        var year = month > periodEnd.Month ? periodEnd.Year - 1 : periodEnd.Year;
        if (month is < 1 or > 12 || day < 1 || day > DateTime.DaysInMonth(year, month))
            return null;
        return new DateOnly(year, month, day);
    }
}
