using UglyToad.PdfPig.Content;
using UglyToad.PdfPig.Core;
using UglyToad.PdfPig.Writer;

namespace PersonligFinans.Api.Tests;

public record StatementPdfRow(
    string Description,
    string InterestDate,
    string? Out,
    string? In,
    string BookedDate,
    string BankReference1,
    string BankReference2,
    string? Continuation = null);

// One page of rows; CarriedBalance is the running balance carried over to the next page.
public record StatementPdfPage(IReadOnlyList<StatementPdfRow> Rows, string? CarriedBalance = null);

// Builds an anonymised Sparebanken Norge-style statement PDF at test time, laid out like the
// real one (same columns, right-aligned amounts), so tests run through real PDF text extraction.
public static class StatementPdf
{
    private const double FontSize = 7;
    private const double DescriptionX = 40;
    private const double InterestDateX = 290;
    private const double OutRight = 385;
    private const double InRight = 450;
    private const double BookedX = 465;
    private const double BankReference1Right = 535;
    private const double BankReference2Right = 585;

    // The Standard 14 PDF fonts can't encode "å", so embed a system TrueType font instead.
    private static readonly string[] FontCandidates =
    [
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Fonts), "arial.ttf"),
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
    ];

    private static readonly Lazy<byte[]> FontBytes = new(() =>
    {
        var path = FontCandidates.FirstOrDefault(File.Exists)
            ?? throw new InvalidOperationException(
                $"No TrueType font found for generating test PDFs. Tried: {string.Join(", ", FontCandidates)}");
        return File.ReadAllBytes(path);
    });

    public static byte[] Create(
        string accountNumber,
        string period,
        string openingBalance,
        IEnumerable<StatementPdfRow> rows,
        string closingBalance) =>
        Create(accountNumber, period, openingBalance, [new StatementPdfPage(rows.ToList())], closingBalance);

    // Each page but the last needs a CarriedBalance, printed as "Overført til neste side" at its
    // bottom and "Overført fra forrige side" at the top of the next page, as the bank does.
    public static byte[] Create(
        string accountNumber,
        string period,
        string openingBalance,
        IReadOnlyList<StatementPdfPage> pages,
        string closingBalance)
    {
        var builder = new PdfDocumentBuilder();
        var font = builder.AddTrueTypeFont(FontBytes.Value);
        PdfPageBuilder page = null!;
        var y = 0.0;

        void Left(string text, double x) => page.AddText(text, FontSize, new PdfPoint(x, y), font);

        void Right(string text, double right)
        {
            var width = page.MeasureText(text, FontSize, new PdfPoint(0, 0), font)
                .Max(l => l.EndBaseLine.X);
            page.AddText(text, FontSize, new PdfPoint(right - width, y), font);
        }

        void NextLine() => y -= 12;

        for (var pageIndex = 0; pageIndex < pages.Count; pageIndex++)
        {
            page = builder.AddPage(PageSize.A4);
            y = 800.0;

            Left($"Dato: 31.08.2026 Sidenr. {pageIndex + 1} 180993", DescriptionX);
            NextLine();
            Left("Ola Nordmann", DescriptionX);
            NextLine();
            Left("Testveien 1, 0001 OSLO", DescriptionX);
            NextLine();
            NextLine();
            Left($"Kontoutskrift nr. 8 for konto {accountNumber} i perioden {period} Testkonto Brukskonto.", DescriptionX);
            NextLine();
            Left("Forklaring", DescriptionX);
            Left("Rentedato", InterestDateX);
            Right("Ut av konto", OutRight);
            Right("Inn på konto", InRight);
            Left("Bokført", BookedX);
            Right("Referanse", BankReference1Right);
            NextLine();

            if (pageIndex == 0)
                Left("Saldo fra kontoutskrift 31.07.2026", DescriptionX);
            else
                Left("Overført fra forrige side", DescriptionX);
            Right(pageIndex == 0 ? openingBalance : pages[pageIndex - 1].CarriedBalance!, InRight);
            NextLine();

            foreach (var row in pages[pageIndex].Rows)
            {
                Left(row.Description, DescriptionX);
                Left(row.InterestDate, InterestDateX);
                if (row.Out is not null) Right(row.Out, OutRight);
                if (row.In is not null) Right(row.In, InRight);
                Left(row.BookedDate, BookedX);
                Right(row.BankReference1, BankReference1Right);
                Right(row.BankReference2, BankReference2Right);
                NextLine();
                if (row.Continuation is not null)
                {
                    Left(row.Continuation, DescriptionX);
                    NextLine();
                }
            }

            if (pageIndex < pages.Count - 1)
            {
                Left("Overført til neste side", DescriptionX);
                Right(pages[pageIndex].CarriedBalance!, InRight);
            }
            else
            {
                Left("Saldo i Deres favør", DescriptionX);
                Right(closingBalance, InRight);
                NextLine();
                Left("Betalte omkostninger i år", DescriptionX);
                Right("0,00", OutRight);
                Right("0,00", InRight);
                NextLine();
                NextLine();
                Left("Vi gjør oppmerksom på at norske banker er pålagt å rapportere valutatransaksjoner og bruk av kort i utlandet", DescriptionX);
                NextLine();
                Left("til Valutaregisteret.", DescriptionX);
            }

            y = 40;
            Left("KU000", DescriptionX);
            NextLine();
            Left("Testbanken, Postboks 1, 0001 OSLO", DescriptionX);
        }

        return builder.Build();
    }
}
