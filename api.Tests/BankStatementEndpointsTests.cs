using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PersonligFinans.Api.BankStatements;
using PersonligFinans.Api.Data;

namespace PersonligFinans.Api.Tests;

[Collection(ApiCollection.Name)]
public class BankStatementEndpointsTests
{
    private readonly PostgresApiFactory _factory;
    private readonly HttpClient _client;

    public BankStatementEndpointsTests(PostgresApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    private async Task<HttpResponseMessage> Upload(byte[] pdf)
    {
        var file = new ByteArrayContent(pdf);
        file.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
        using var form = new MultipartFormDataContent { { file, "file", "kontoutskrift.pdf" } };
        return await _client.PostAsync("/api/bank-statements", form);
    }

    [Fact]
    public async Task Post_OnePageStatement_StoresUncategorizedTransactionsLinkedToStatement()
    {
        var pdf = StatementPdf.Create(
            accountNumber: "1111.22.33333",
            period: "01.08.2026 - 31.08.2026",
            openingBalance: "1.000,00",
            rows:
            [
                new("Til: Strømselskap AS Betalt: 01.08.26", "0308", "5.356,00", null, "0308", "10000000001", "100000002"),
                new("*1111 31.07 Nok 296.60 Matbutikk Sentrum Kurs: 1.0000", "0308", "296,60", null, "0308", "21", "12345678"),
                new("*1111 03.08 Nok 50.00 Rema 1000", "0408", "50,00", null, "0408", "21", "12345678"),
                new("Overføring mellom egne kontoer", "1308", null, "22.000,00", "1308", "100003", "100000002"),
                new("Lønn Fra: Testfirma AS", "1908", null, "24.500,00", "1908", "100000004", "100000005"),
            ],
            closingBalance: "41.797,40");

        var response = await Upload(pdf);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<BankStatementResponse>();
        Assert.Equal("1111.22.33333", created!.AccountNumber);
        Assert.Equal(new DateOnly(2026, 8, 1), created.PeriodStart);
        Assert.Equal(new DateOnly(2026, 8, 31), created.PeriodEnd);
        Assert.Equal(5, created.TransactionCount);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var stored = await db.Transactions
            .Where(t => t.BankStatementId == created.Id)
            .OrderBy(t => t.Id)
            .ToListAsync();
        Assert.Equal(
            [
                (new DateOnly(2026, 8, 3), "Strømselskap AS", -5356.00m),
                (new DateOnly(2026, 8, 3), "Matbutikk Sentrum", -296.60m),
                (new DateOnly(2026, 8, 4), "Rema 1000", -50.00m),
                (new DateOnly(2026, 8, 13), "Overføring mellom egne kontoer", 22000.00m),
                (new DateOnly(2026, 8, 19), "Lønn Fra: Testfirma AS", 24500.00m),
            ],
            stored.Select(t => (t.PostedDate, t.Description, t.Amount)));
        Assert.All(stored, t => Assert.Null(t.CategoryId));
        Assert.All(stored, t => Assert.Null(t.Reference));
    }

    [Fact]
    public async Task Post_TwoPageStatementWithWrappedRow_ImportsRowsFromBothPages()
    {
        var pdf = StatementPdf.Create(
            accountNumber: "2222.33.44444",
            period: "01.08.2026 - 31.08.2026",
            openingBalance: "1.000,00",
            pages:
            [
                new(
                    [
                        new("Til: Strømselskap AS Betalt: 01.08.26", "0308", "5.356,00", null, "0308", "10000000001", "100000002"),
                        new("*1111 31.07 Nok 296.60 Matbutikk Sentrum Kurs:", "0308", "296,60", null, "0308", "21", "12345678",
                            Continuation: "1.0000"),
                        new("Overføring mellom egne kontoer", "1308", null, "22.000,00", "1308", "100003", "100000002"),
                    ],
                    CarriedBalance: "17.347,40"),
                new(
                    [
                        new("Lønn Fra: Testfirma AS", "1908", null, "24.500,00", "1908", "100000004", "100000005"),
                        new("Varer 28.08 Matbutikk Sentrum", "2908", "1.234,50", null, "2908", "21", "12345678"),
                    ]),
            ],
            closingBalance: "40.612,90");

        var response = await Upload(pdf);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<BankStatementResponse>();
        Assert.Equal(5, created!.TransactionCount);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var stored = await db.Transactions
            .Where(t => t.BankStatementId == created.Id)
            .OrderBy(t => t.Id)
            .ToListAsync();
        Assert.Equal(
            [
                (new DateOnly(2026, 8, 3), -5356.00m),
                (new DateOnly(2026, 8, 3), -296.60m),
                (new DateOnly(2026, 8, 13), 22000.00m),
                (new DateOnly(2026, 8, 19), 24500.00m),
                (new DateOnly(2026, 8, 29), -1234.50m),
            ],
            stored.Select(t => (t.PostedDate, t.Amount)));
    }
}
