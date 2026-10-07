using PersonligFinans.Api.BankStatements;

namespace PersonligFinans.Api.Tests;

public class StatementParserTests
{
    private const string Header =
        "Kontoutskrift nr. 8 for konto 1234.56.78901 i perioden 01.08.2026 - 31.08.2026 Testbank Brukskonto.";

    private static StatementLine Out(string text, string amount, string booked) =>
        new(text, Out: amount, BookedDate: booked);

    private static StatementLine In(string text, string amount, string? booked = null) =>
        new(text, In: amount, BookedDate: booked);

    [Fact]
    public void Parse_OnePageStatement_ReadsHeaderBalancesAndSignedRows()
    {
        var result = StatementParser.Parse(
        [
            new(Header),
            new("Forklaring Rentedato Ut av konto Inn på konto Bokført Referanse"),
            In("Saldo fra kontoutskrift 31.07.2026", "1.000,00"),
            Out("Til: Strømselskap AS Betalt: 01.08.26", "5.356,00", "0308"),
            In("Overføring mellom egne kontoer", "22.000,00", "1308"),
            Out("*1111 31.07 Nok 296.60 Matbutikk Sentrum Kurs: 1.0000", "296,60", "0308"),
            In("Saldo i Deres favør", "17.347,40"),
            new("Betalte omkostninger i år", Out: "0,00", In: "0,00"),
        ]);

        Assert.Null(result.Error);
        var statement = result.Statement!;
        Assert.Equal("1234.56.78901", statement.AccountNumber);
        Assert.Equal(new DateOnly(2026, 8, 1), statement.PeriodStart);
        Assert.Equal(new DateOnly(2026, 8, 31), statement.PeriodEnd);
        Assert.Equal(1000.00m, statement.OpeningBalance);
        Assert.Equal(17347.40m, statement.ClosingBalance);
        Assert.Equal(
            [
                new StatementRow(new DateOnly(2026, 8, 3), "Strømselskap AS", -5356.00m),
                new StatementRow(new DateOnly(2026, 8, 13), "Overføring mellom egne kontoer", 22000.00m),
                new StatementRow(new DateOnly(2026, 8, 3), "Matbutikk Sentrum", -296.60m),
            ],
            statement.Rows);
    }

    [Fact]
    public void Parse_TwoPageStatement_ReadsRowsFromBothPagesAndIgnoresPageFurniture()
    {
        var result = StatementParser.Parse(
        [
            new("Dato: 31.08.2026 Sidenr. 1 180993"),
            new("Ola Nordmann Testveien 1, 0001 OSLO"),
            new(Header),
            new("Forklaring Rentedato Ut av konto Inn på konto Bokført Referanse"),
            In("Saldo fra kontoutskrift 31.07.2026", "1.000,00"),
            Out("Varer 02.08 Matbutikk Sentrum", "100,00", "0408"),
            In("Overført til neste side", "900,00"),
            new("KU000"),
            new("Testbanken Postboks 1, 0001 OSLO"),
            new("Dato: 31.08.2026 Sidenr. 2 180993"),
            new("Ola Nordmann Testveien 1, 0001 OSLO"),
            new(Header),
            new("Forklaring Rentedato Ut av konto Inn på konto Bokført Referanse"),
            In("Overført fra forrige side", "900,00"),
            In("Lønn Fra: Testfirma AS", "500,00", "1908"),
            In("Saldo i Deres favør", "1.400,00"),
            new("Betalte omkostninger i år", Out: "0,00", In: "0,00"),
            new("Vi gjør oppmerksom på at norske banker er pålagt å rapportere valutatransaksjoner og bruk av kort i utlandet"),
            new("til Valutaregisteret."),
            new("KU000"),
            new("Testbanken Postboks 1, 0001 OSLO"),
        ]);

        Assert.Null(result.Error);
        Assert.Equal(
            [
                new StatementRow(new DateOnly(2026, 8, 4), "Matbutikk Sentrum", -100.00m),
                new StatementRow(new DateOnly(2026, 8, 19), "Lønn Fra: Testfirma AS", 500.00m),
            ],
            result.Statement!.Rows);
    }

    [Fact]
    public void Parse_WrappedRows_JoinsContinuationLinesOntoPrecedingRow()
    {
        var result = StatementParser.Parse(
        [
            new(Header),
            new("Forklaring Rentedato Ut av konto Inn på konto Bokført Referanse"),
            In("Saldo fra kontoutskrift 31.07.2026", "1.000,00"),
            Out("*1111 31.07 Nok 296.60 Matbutikk Sentrum Kurs:", "296,60", "0308"),
            new("1.0000"),
            Out("Varer 02.08 Matbutikk Sentrum", "100,00", "0408"),
            Out("*1111 30.08 Eur 10.00 Kafé Paris Kurs:", "117,40", "3108"),
            new("11.7400"),
            In("Overført til neste side", "486,00"),
            new("KU000"),
            new("Dato: 31.08.2026 Sidenr. 2 180993"),
            new(Header),
            new("Forklaring Rentedato Ut av konto Inn på konto Bokført Referanse"),
            In("Overført fra forrige side", "486,00"),
            In("Saldo i Deres favør", "486,00"),
        ]);

        Assert.Null(result.Error);
        Assert.Equal(
            [
                new StatementRow(new DateOnly(2026, 8, 3), "Matbutikk Sentrum", -296.60m),
                new StatementRow(new DateOnly(2026, 8, 4), "Matbutikk Sentrum", -100.00m),
                new StatementRow(new DateOnly(2026, 8, 31), "Kafé Paris", -117.40m),
            ],
            result.Statement!.Rows);
    }

    [Fact]
    public void Parse_RowsThatDoNotAddUpToClosingBalance_Fails()
    {
        var result = StatementParser.Parse(
        [
            new(Header),
            In("Saldo fra kontoutskrift 31.07.2026", "1.000,00"),
            Out("Til: Strømselskap AS Betalt: 01.08.26", "100,00", "0308"),
            In("Saldo i Deres favør", "1.000,00"),
        ]);

        Assert.Null(result.Statement);
        Assert.Contains("don't add up", result.Error);
    }

    [Fact]
    public void Parse_BookingFromPreviousYear_GetsPreviousYear()
    {
        var result = StatementParser.Parse(
        [
            new("Kontoutskrift nr. 1 for konto 1234.56.78901 i perioden 31.12.2026 - 31.01.2027 Testbank Brukskonto."),
            In("Saldo fra kontoutskrift 30.12.2026", "1.000,00"),
            Out("Varer 30.12 Matbutikk Sentrum", "100,00", "3112"),
            Out("Varer 02.01 Matbutikk Sentrum", "50,00", "0201"),
            In("Saldo i Deres favør", "850,00"),
        ]);

        Assert.Equal(
            [new DateOnly(2026, 12, 31), new DateOnly(2027, 1, 2)],
            result.Statement!.Rows.Select(r => r.BookedDate));
    }

    [Fact]
    public void Parse_ImpossibleBookedDate_Fails()
    {
        var result = StatementParser.Parse(
        [
            new(Header),
            In("Saldo fra kontoutskrift 31.07.2026", "1.000,00"),
            Out("Varer 02.08 Matbutikk", "50,00", "3102"),
            In("Saldo i Deres favør", "950,00"),
        ]);

        Assert.Null(result.Statement);
        Assert.Contains("Could not read", result.Error);
    }

    // Parses a statement with a single money-out row and returns that row's Description.
    private static string DescriptionOf(string text) =>
        StatementParser.Parse(
        [
            new(Header),
            In("Saldo fra kontoutskrift 31.07.2026", "1.000,00"),
            Out(text, "100,00", "0308"),
            In("Saldo i Deres favør", "900,00"),
        ]).Statement!.Rows.Single().Description;

    [Theory]
    [InlineData("*1111 31.07 Nok 296.60 Rema 1000 Sentrum Kurs: 1.0000", "Rema 1000 Sentrum")]
    [InlineData("*1111 14.08 Eur 25.00 Some Shop Kurs: 11.6400", "Some Shop")]
    [InlineData("*1111 03.08 Nok 50.00 Rema 1000", "Rema 1000")]
    [InlineData("Til: Fjordkraft AS Betalt: 17.08.26", "Fjordkraft AS")]
    [InlineData("Til: 9999.88.77777 Betalt: 13.08.26", "9999.88.77777")]
    [InlineData("Varer 04.08 Rema Storgata Nedre Torget Oslo", "Rema Storgata Nedre Torget Oslo")]
    [InlineData("Overføring mellom egne kontoer", "Overføring mellom egne kontoer")]
    [InlineData("Lønn Fra: Testfirma AS", "Lønn Fra: Testfirma AS")]
    public void Parse_RowDescription_IsCleaned(string text, string expected) =>
        Assert.Equal(expected, DescriptionOf(text));

    [Fact]
    public void Parse_LongRowDescription_IsTruncatedToDescriptionMaxLength() =>
        Assert.Equal(new string('x', 200), DescriptionOf(new string('x', 250)));

    [Fact]
    public void Parse_ForeignCurrencyCardRow_KeepsBookedNokAmount()
    {
        var result = StatementParser.Parse(
        [
            new(Header),
            In("Saldo fra kontoutskrift 31.07.2026", "1.000,00"),
            Out("*1111 14.08 Eur 25.00 Some Shop Kurs: 11.6400", "291,00", "1608"),
            In("Saldo i Deres favør", "709,00"),
        ]);

        Assert.Equal(
            [new StatementRow(new DateOnly(2026, 8, 16), "Some Shop", -291.00m)],
            result.Statement!.Rows);
    }

    [Fact]
    public void Parse_LinesWithoutStatementHeader_Fails()
    {
        var result = StatementParser.Parse([new("Faktura nr. 42"), In("Å betale", "100,00")]);

        Assert.Null(result.Statement);
        Assert.Contains("not a Sparebanken Norge Bank Statement", result.Error);
    }
}
