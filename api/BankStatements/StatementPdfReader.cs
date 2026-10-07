using System.Text.RegularExpressions;
using UglyToad.PdfPig;
using UglyToad.PdfPig.Content;

namespace PersonligFinans.Api.BankStatements;

// Turns a statement PDF into StatementLines, assigning each word to a column by its horizontal
// position under the column headings. Rentedato and the bank's reference numbers are dropped.
public static partial class StatementPdfReader
{
    // Words whose baselines are this close (in points) belong to the same line.
    private const double LineTolerance = 2;

    // How far (in points) a left-aligned value may start before its column heading.
    private const double ColumnTolerance = 3;

    [GeneratedRegex(@"^-?\d{1,3}(\.\d{3})*,\d{2}$")]
    private static partial Regex AmountPattern();

    public static IReadOnlyList<StatementLine> Read(Stream pdf)
    {
        using var document = PdfDocument.Open(pdf);
        return document.GetPages().SelectMany(ReadPage).ToList();
    }

    private static IEnumerable<StatementLine> ReadPage(Page page)
    {
        var lines = GroupIntoLines(page.GetWords());
        var headingIndex = lines.FindIndex(line => FindColumns(line) is not null);
        var columns = headingIndex < 0 ? null : FindColumns(lines[headingIndex]);

        for (var i = 0; i < lines.Count; i++)
        {
            var text = new List<string>();
            string? outAmount = null;
            string? inAmount = null;
            string? bookedDate = null;

            // Only lines below the column headings are laid out in columns.
            foreach (var word in lines[i])
            {
                switch (i > headingIndex ? columns?.Classify(word) : null)
                {
                    case Column.Out: outAmount = word.Text; break;
                    case Column.In: inAmount = word.Text; break;
                    // The first word under "Bokført" is the date; the bank references follow it.
                    case Column.BookedOrBankReference: bookedDate ??= word.Text; break;
                    case Column.InterestDate: break;
                    default: text.Add(word.Text); break;
                }
            }

            yield return new StatementLine(string.Join(' ', text), outAmount, inAmount, bookedDate);
        }
    }

    private static List<List<Word>> GroupIntoLines(IEnumerable<Word> words)
    {
        var lines = new List<List<Word>>();
        foreach (var word in words.OrderByDescending(Baseline).ThenBy(w => w.BoundingBox.Left))
        {
            var line = lines.LastOrDefault();
            if (line is not null && Math.Abs(Baseline(line[0]) - Baseline(word)) <= LineTolerance)
                line.Add(word);
            else
                lines.Add([word]);
        }

        foreach (var line in lines)
            line.Sort((a, b) => a.BoundingBox.Left.CompareTo(b.BoundingBox.Left));
        return lines;
    }

    private static double Baseline(Word word) => word.Letters[0].StartBaseLine.Y;

    private static Columns? FindColumns(List<Word> line)
    {
        var texts = line.Select(w => w.Text).ToList();
        var interest = texts.IndexOf("Rentedato");
        var booked = texts.IndexOf("Bokført");
        var outStart = texts.IndexOf("Ut");
        var inStart = texts.IndexOf("Inn");
        if (interest < 0 || booked < 0 || outStart < 0 || inStart < 0 || inStart + 2 >= line.Count)
            return null;

        return new Columns(
            InterestLeft: line[interest].BoundingBox.Left - ColumnTolerance,
            AmountsFrom: line[interest].BoundingBox.Right,
            OutRight: line[outStart + 2].BoundingBox.Right,
            InRight: line[inStart + 2].BoundingBox.Right,
            BookedLeft: line[booked].BoundingBox.Left - ColumnTolerance);
    }

    private enum Column { Description, InterestDate, Out, In, BookedOrBankReference }

    private sealed record Columns(
        double InterestLeft,
        double AmountsFrom,
        double OutRight,
        double InRight,
        double BookedLeft)
    {
        public Column Classify(Word word)
        {
            var box = word.BoundingBox;
            if (box.Left < InterestLeft) return Column.Description;
            if (box.Left >= BookedLeft) return Column.BookedOrBankReference;
            if (box.Left < AmountsFrom || !AmountPattern().IsMatch(word.Text)) return Column.InterestDate;

            // Amounts are right-aligned under their heading, so each goes to the nearest heading.
            return Math.Abs(box.Right - OutRight) <= Math.Abs(box.Right - InRight) ? Column.Out : Column.In;
        }
    }
}
