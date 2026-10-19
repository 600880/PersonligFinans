using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PersonligFinans.Api.Categories;
using PersonligFinans.Api.CategorizationRules;
using PersonligFinans.Api.Data;
using PersonligFinans.Api.Transactions;
using Xunit;

namespace PersonligFinans.Api.Tests;

[Collection(ApiCollection.Name)]
public class TransactionEndpointsTests : IAsyncLifetime
{
    private readonly PostgresApiFactory _factory;
    private readonly string _email = SignedInClient.UniqueEmail();
    private HttpClient _client = null!;
    private TestCategories _categories = null!;

    public TransactionEndpointsTests(PostgresApiFactory factory)
    {
        _factory = factory;
    }

    public async Task InitializeAsync()
    {
        _client = await _factory.CreateSignedInClientAsync(_email);
        _categories = await TestCategories.Of(_client);
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private sealed record TransactionRequest(
        string? Date, string? Description, decimal? Amount, string? Note, int? CategoryId);

    // A valid manually-entered Transaction in Other, of which each test changes only what it is about.
    private TransactionRequest ValidRequest => new("2026-09-24", "Rema 1000", -249.90m, Note: null, _categories.Other);

    private async Task<Dictionary<string, string[]>> PostExpectingValidationErrors(object request)
    {
        var response = await _client.PostAsJsonAsync("/api/transactions", request);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        return new Dictionary<string, string[]>(problem!.Errors);
    }

    [Fact]
    public async Task Get_Categories_ReturnsTheUsersCategories()
    {
        var categories = (await _client.GetFromJsonAsync<List<CategoryResponse>>("/api/categories"))!;

        Assert.Equal(TestCategories.All.Select(c => c.Name).Order(), categories.Select(c => c.Name).Order());
    }

    [Fact]
    public async Task Post_ValidTransaction_StoresItAndReturnsCreated()
    {
        var response = await _client.PostAsJsonAsync(
            "/api/transactions",
            ValidRequest with { Description = "  Invoice 42 paid  ", Amount = 1500m, Note = "INV-42" });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<TransactionResponse>();

        await using var user = await UserDatabase.OfAsync(_factory, _email);
        var db = user.Db;
        var stored = await db.Transactions.SingleAsync(t => t.Id == created!.Id);
        Assert.Equal(new DateOnly(2026, 9, 24), stored.PostedDate);
        Assert.Equal("Invoice 42 paid", stored.Description);
        Assert.Equal(1500m, stored.Amount);
        Assert.Equal("INV-42", stored.Note);
        Assert.Equal(_categories.Other, stored.CategoryId);
        Assert.Null(stored.BankStatementId);
    }

    [Fact]
    public async Task Post_BlankNote_IsStoredAsNull()
    {
        var response = await _client.PostAsJsonAsync("/api/transactions", ValidRequest with { Note = "   " });

        var created = await response.Content.ReadFromJsonAsync<TransactionResponse>();
        Assert.Null(created!.Note);
    }

    [Fact]
    public async Task Post_MissingFields_ReturnsErrorPerField()
    {
        var errors = await PostExpectingValidationErrors(
            ValidRequest with { Date = null, Description = " ", Amount = null, CategoryId = null });

        Assert.Equal(["amount", "categoryId", "date", "description"], errors.Keys.Order());
    }

    [Fact]
    public async Task Post_ZeroAmount_IsRejected()
    {
        var errors = await PostExpectingValidationErrors(ValidRequest with { Amount = 0m });

        Assert.Contains("amount", errors.Keys);
    }

    [Fact]
    public async Task Post_AmountWithMoreThanTwoDecimals_IsRejected()
    {
        var errors = await PostExpectingValidationErrors(ValidRequest with { Amount = 10.005m });

        Assert.Contains("amount", errors.Keys);
    }

    [Fact]
    public async Task Post_UnknownCategory_IsRejected()
    {
        var errors = await PostExpectingValidationErrors(ValidRequest with { CategoryId = 9999 });

        Assert.Contains("categoryId", errors.Keys);
    }

    [Fact]
    public async Task Post_TooLongDescriptionAndNote_AreRejected()
    {
        var errors = await PostExpectingValidationErrors(
            ValidRequest with { Description = new string('x', 201), Note = new string('x', 257) });

        Assert.Contains("description", errors.Keys);
        Assert.Contains("note", errors.Keys);
    }

    private async Task AddManualTransaction(string date, string description)
    {
        var response = await _client.PostAsJsonAsync(
            "/api/transactions",
            ValidRequest with { Date = date, Description = description });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    // Imports a statement of one month with a purchase of 10,00 per row. Each row is a booked date
    // (DDMM) and a description no rule matches, so the imported Transactions are Uncategorized.
    private Task ImportStatement(string period, params (string BookedDate, string Description)[] rows) =>
        ImportStatement(_client, period, rows);

    // Imports as above, through an API that has the given rule generator.
    private async Task ImportStatement(
        IRuleGenerator ruleGenerator, string period, params (string BookedDate, string Description)[] rows)
    {
        await using var api = _factory.WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services => services.AddSingleton(ruleGenerator)));
        using var client = await api.CreateClientSignedInAsAsync(_email);
        await ImportStatement(client, period, rows);
    }

    private static async Task ImportStatement(
        HttpClient client, string period, params (string BookedDate, string Description)[] rows)
    {
        var digits = Random.Shared.NextInt64(0, 100_000_000_000).ToString("D11");
        var pdf = StatementPdf.Create(
            accountNumber: $"{digits[..4]}.{digits[4..6]}.{digits[6..]}",
            period,
            openingBalance: "1.000,00",
            rows: rows.Select(r => new StatementPdfRow(r.Description, r.BookedDate, "10,00", null, r.BookedDate, "21", "12345678")),
            closingBalance: $"{1000 - 10 * rows.Length},00");
        var file = new ByteArrayContent(pdf);
        file.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
        using var form = new MultipartFormDataContent { { file, "file", "kontoutskrift.pdf" } };

        var response = await client.PostAsync("/api/bank-statements", form);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    private async Task<List<TransactionResponse>> TransactionsOf(int year, int month) =>
        (await _client.GetFromJsonAsync<List<TransactionResponse>>($"/api/transactions?year={year}&month={month}"))!;

    [Fact]
    public async Task Get_Months_ListsEachMonthWithTransactionsOnceNewestFirst()
    {
        await AddManualTransaction("2041-03-05", "manual");
        await AddManualTransaction("2041-03-20", "manual again");
        await ImportStatement("01.05.2041 - 31.05.2041", ("0405", "imported"));

        var months = (await _client.GetFromJsonAsync<List<TransactionMonthResponse>>("/api/transactions/months"))!;

        Assert.Contains(new TransactionMonthResponse(2041, 5), months);
        Assert.Contains(new TransactionMonthResponse(2041, 3), months);
        Assert.DoesNotContain(new TransactionMonthResponse(2041, 4), months);
        Assert.Equal(months.Distinct(), months);
        Assert.Equal(months.OrderByDescending(m => m.Year).ThenByDescending(m => m.Month), months);
    }

    [Fact]
    public async Task Get_Month_ListsImportedAndManualTransactionsOfThatMonthNewestFirst()
    {
        await AddManualTransaction("2042-01-31", "day before");
        await AddManualTransaction("2042-02-01", "first day");
        await AddManualTransaction("2042-02-14", "manual mid");
        await AddManualTransaction("2042-03-01", "day after");
        // Imported after the manual one on the same date, so it has the higher id.
        await ImportStatement(
            "01.02.2042 - 28.02.2042",
            ("1402", "imported mid"),
            ("2802", "last day"));

        var transactions = await TransactionsOf(2042, 2);

        Assert.Equal(
            [
                (new DateOnly(2042, 2, 28), "last day", -10m, (int?)null),
                (new DateOnly(2042, 2, 14), "imported mid", -10m, null),
                (new DateOnly(2042, 2, 14), "manual mid", -249.90m, _categories.Other),
                (new DateOnly(2042, 2, 1), "first day", -249.90m, _categories.Other),
            ],
            transactions.Select(t => (t.Date, t.Description, t.Amount, t.CategoryId)));
    }

    [Fact]
    public async Task Get_MonthWithoutTransactions_ReturnsEmptyList()
    {
        var transactions = await _client.GetFromJsonAsync<List<TransactionResponse>>(
            "/api/transactions?year=2043&month=7");

        Assert.Empty(transactions!);
    }

    [Fact]
    public async Task Get_YearWithoutMonth_ListsTheWholeYearsTransactionsNewestFirst()
    {
        await AddManualTransaction("2045-12-31", "last day");
        await AddManualTransaction("2044-12-31", "day before");
        await AddManualTransaction("2045-06-15", "mid");
        await AddManualTransaction("2045-01-01", "first day");
        await AddManualTransaction("2046-01-01", "day after");

        var transactions = await _client.GetFromJsonAsync<List<TransactionResponse>>("/api/transactions?year=2045");

        Assert.Equal(
            ["last day", "mid", "first day"],
            transactions!.Select(t => t.Description));
    }

    [Theory]
    [InlineData("year=2026&month=0", "month")]
    [InlineData("year=2026&month=13", "month")]
    [InlineData("year=1899&month=1", "year")]
    [InlineData("year=1899", "year")]
    [InlineData("year=3000", "year")]
    [InlineData("year=3000&month=1", "year")]
    [InlineData("month=1", "year")]
    public async Task Get_InvalidYearOrMonth_IsRejected(string query, string field)
    {
        var response = await _client.GetAsync($"/api/transactions?{query}");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        Assert.Contains(field, problem!.Errors.Keys);
    }

    private const string CorrectionPeriod = "01.01.2044 - 31.01.2044";

    private Task ImportForCorrection(params string[] descriptions) =>
        ImportStatement(CorrectionPeriod, descriptions.Select(d => ("1501", d)).ToArray());

    private Task ImportForCorrection(IRuleGenerator ruleGenerator, params string[] descriptions) =>
        ImportStatement(ruleGenerator, CorrectionPeriod, descriptions.Select(d => ("1501", d)).ToArray());

    // This test's Transaction with the given description, as the month's list shows it.
    private async Task<TransactionResponse> Own(string description) =>
        (await TransactionsOf(2044, 1)).Single(t => t.Description == description);

    private Task<HttpResponseMessage> ChangeCategory(int transactionId, int? categoryId) =>
        _client.PutAsJsonAsync($"/api/transactions/{transactionId}/category", new { categoryId });

    private async Task<TransactionResponse> CategoryChanged(int transactionId, int categoryId)
    {
        var response = await ChangeCategory(transactionId, categoryId);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<TransactionResponse>())!;
    }

    private async Task<int> AddRule(string keyword, int categoryId)
    {
        var response = await _client.PostAsJsonAsync("/api/categorization-rules", new { keyword, categoryId });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<SavedCategorizationRuleResponse>())!.Id;
    }

    private async Task<List<CategorizationRuleResponse>> Rules() =>
        (await _client.GetFromJsonAsync<List<CategorizationRuleResponse>>("/api/categorization-rules"))!;

    [Fact]
    public async Task Put_Category_OfUncategorizedImportedTransaction_SetsIt()
    {
        await ImportForCorrection("Kafé");
        var imported = await Own("Kafé");

        var changed = await CategoryChanged(imported.Id, _categories.Restaurants);

        Assert.Equal(imported with { CategoryId = _categories.Restaurants, Locked = true }, changed);
        Assert.Equal(_categories.Restaurants, (await Own("Kafé")).CategoryId);
    }

    [Fact]
    public async Task Put_Category_CorrectedImportedTransactionKeepsItWhenAMatchingRuleIsAdded()
    {
        await ImportForCorrection("Kafé Nord", "Kafé Sør");
        await CategoryChanged((await Own("Kafé Nord")).Id, _categories.Restaurants);

        await AddRule("kafé", _categories.Groceries);

        Assert.Equal(_categories.Restaurants, (await Own("Kafé Nord")).CategoryId);
        Assert.Equal(_categories.Groceries, (await Own("Kafé Sør")).CategoryId);
    }

    [Fact]
    public async Task Put_Category_CorrectedImportedTransactionKeepsItWhenTheRuleThatCategorizedItIsEdited()
    {
        var ruleId = await AddRule("kafé", _categories.Groceries);
        await ImportForCorrection("Kafé Nord", "Kafé Sør");
        await CategoryChanged((await Own("Kafé Nord")).Id, _categories.Restaurants);

        var response = await _client.PutAsJsonAsync(
            $"/api/categorization-rules/{ruleId}", new { keyword = "kafé", categoryId = _categories.Shopping });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(_categories.Restaurants, (await Own("Kafé Nord")).CategoryId);
        Assert.Equal(_categories.Shopping, (await Own("Kafé Sør")).CategoryId);
    }

    [Fact]
    public async Task Put_Category_CorrectedImportedTransactionKeepsItWhenTheRuleThatCategorizedItIsDeleted()
    {
        var ruleId = await AddRule("kafé", _categories.Groceries);
        await ImportForCorrection("Kafé Nord", "Kafé Sør");
        await CategoryChanged((await Own("Kafé Nord")).Id, _categories.Restaurants);

        var response = await _client.DeleteAsync($"/api/categorization-rules/{ruleId}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(_categories.Restaurants, (await Own("Kafé Nord")).CategoryId);
        Assert.Null((await Own("Kafé Sør")).CategoryId);
    }

    [Fact]
    public async Task Put_Category_CorrectedImportedTransactionKeepsItWhenALaterImportsAiGeneratedRuleMatchesIt()
    {
        await ImportForCorrection("Kafé Nord");
        await CategoryChanged((await Own("Kafé Nord")).Id, _categories.Shopping);
        var generator = new FakeRuleGenerator().Proposing("Kafé Sør", "kafé", "Restaurants");

        await ImportForCorrection(generator, "Kafé Sør");

        var rule = Assert.Single(await Rules(), r => r.Keyword == "kafé");
        Assert.True(rule.AiGenerated);
        Assert.Equal(_categories.Restaurants, (await Own("Kafé Sør")).CategoryId);
        Assert.Equal(_categories.Shopping, (await Own("Kafé Nord")).CategoryId);
    }

    [Fact]
    public async Task Put_Category_CreatesNoRuleAndLeavesTheRulesUnchanged()
    {
        await AddRule("kafé", _categories.Groceries);
        await ImportForCorrection("Kafé Nord", "Frisør");
        var before = await Rules();

        await CategoryChanged((await Own("Kafé Nord")).Id, _categories.Restaurants);
        await CategoryChanged((await Own("Frisør")).Id, _categories.Shopping);

        Assert.Equal(before, await Rules());
    }

    [Fact]
    public async Task Put_Category_OfTransactionCategorizedByAnAiGeneratedRule_ChangesItAndLeavesTheRuleUnchanged()
    {
        var generator = new FakeRuleGenerator().Proposing("Kafé", "kafé", "Restaurants");
        await ImportForCorrection(generator, "Kafé");
        var rule = Assert.Single(await Rules(), r => r.Keyword == "kafé");
        Assert.True(rule.AiGenerated);
        Assert.Equal(_categories.Restaurants, (await Own("Kafé")).CategoryId);

        await CategoryChanged((await Own("Kafé")).Id, _categories.Groceries);

        Assert.Equal(_categories.Groceries, (await Own("Kafé")).CategoryId);
        Assert.Equal(rule, Assert.Single(await Rules(), r => r.Keyword == "kafé"));
    }

    [Fact]
    public async Task Put_Category_OfManualTransaction_ChangesOnlyItsCategory()
    {
        var response = await _client.PostAsJsonAsync(
            "/api/transactions",
            ValidRequest with { Date = "2044-01-20", Description = "Lunsj", Note = "INV-7" });
        var manual = (await response.Content.ReadFromJsonAsync<TransactionResponse>())!;

        await CategoryChanged(manual.Id, _categories.Groceries);
        var changed = await CategoryChanged(manual.Id, _categories.Restaurants);

        Assert.Equal(manual with { CategoryId = _categories.Restaurants }, changed);
        Assert.Equal(changed, await Own("Lunsj"));
    }

    [Fact]
    public async Task Put_Category_Other_CanBeChosen()
    {
        await ImportForCorrection("Kafé");

        var changed = await CategoryChanged((await Own("Kafé")).Id, _categories.Other);

        Assert.Equal(_categories.Other, changed.CategoryId);
        Assert.Equal(_categories.Other, (await Own("Kafé")).CategoryId);
    }

    [Fact]
    public async Task Get_Month_ShowsAnUncategorizedImportedTransactionAsNotLocked()
    {
        await ImportForCorrection(new FakeRuleGenerator { Unavailable = true }, "Frisør");

        var uncategorized = await Own("Frisør");

        Assert.Equal((null, false), (uncategorized.CategoryId, uncategorized.Locked));
    }

    [Fact]
    public async Task Get_Month_ShowsATransactionCategorizedByARuleAsNotLocked()
    {
        await AddRule("kafé", _categories.Restaurants);
        await ImportForCorrection("Kafé");

        var categorized = await Own("Kafé");

        Assert.Equal((_categories.Restaurants, false), (categorized.CategoryId, categorized.Locked));
    }

    [Fact]
    public async Task Post_ManuallyEnteredTransaction_IsLocked()
    {
        var response = await _client.PostAsJsonAsync(
            "/api/transactions", ValidRequest with { Date = "2044-01-20", Description = "Lunsj" });

        var created = (await response.Content.ReadFromJsonAsync<TransactionResponse>())!;
        Assert.True(created.Locked);
        Assert.True((await Own("Lunsj")).Locked);
    }

    [Fact]
    public async Task Put_Category_OfTransactionCategorizedByARule_LocksIt()
    {
        await AddRule("kafé", _categories.Restaurants);
        await ImportForCorrection("Kafé");

        var changed = await CategoryChanged((await Own("Kafé")).Id, _categories.Groceries);

        Assert.True(changed.Locked);
        Assert.Equal(changed, await Own("Kafé"));
    }

    [Fact]
    public async Task Put_Category_OfUnknownTransaction_ReturnsNotFound()
    {
        var response = await ChangeCategory(int.MaxValue, _categories.Groceries);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Theory]
    [InlineData(null)]
    [InlineData(9999)]
    public async Task Put_MissingOrUnknownCategory_IsRejectedAndLeavesTheTransactionAsItWas(int? categoryId)
    {
        await ImportForCorrection("Kafé");

        var response = await ChangeCategory((await Own("Kafé")).Id, categoryId);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        Assert.Equal(["categoryId"], problem!.Errors.Keys);
        Assert.Null((await Own("Kafé")).CategoryId);
    }

    [Fact]
    public async Task Get_Month_ShowsWhichTransactionsWereImported()
    {
        await AddManualTransaction("2044-01-10", "manual");
        await ImportForCorrection("imported");

        Assert.False((await Own("manual")).Imported);
        Assert.True((await Own("imported")).Imported);
    }

    [Fact]
    public async Task Delete_ManualTransaction_RemovesIt()
    {
        await AddManualTransaction("2044-01-10", "manual");

        var response = await _client.DeleteAsync($"/api/transactions/{(await Own("manual")).Id}");

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Empty(await TransactionsOf(2044, 1));
    }

    [Fact]
    public async Task Delete_ImportedTransaction_IsRefusedAndKeepsIt()
    {
        await ImportForCorrection("imported");
        var imported = await Own("imported");

        var response = await _client.DeleteAsync($"/api/transactions/{imported.Id}");

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal(imported, await Own("imported"));
    }

    [Fact]
    public async Task Delete_UnknownTransaction_ReturnsNotFound()
    {
        var response = await _client.DeleteAsync($"/api/transactions/{int.MaxValue}");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    private Task<HttpResponseMessage> ChangeNote(int transactionId, string? note) =>
        _client.PutAsJsonAsync($"/api/transactions/{transactionId}/note", new { note });

    [Fact]
    public async Task Put_Note_OnManualTransaction_SetsItAndReturnsUpdatedTransaction()
    {
        var response = await _client.PostAsJsonAsync(
            "/api/transactions", ValidRequest with { Date = "2044-01-20", Description = "Kvittering" });
        var manual = (await response.Content.ReadFromJsonAsync<TransactionResponse>())!;

        var noteResponse = await ChangeNote(manual.Id, "Reimbursed by work");

        Assert.Equal(HttpStatusCode.OK, noteResponse.StatusCode);
        var updated = (await noteResponse.Content.ReadFromJsonAsync<TransactionResponse>())!;
        Assert.Equal(manual with { Note = "Reimbursed by work" }, updated);
        Assert.Equal("Reimbursed by work", (await Own("Kvittering")).Note);
    }

    [Fact]
    public async Task Put_Note_OnImportedTransaction_SetsIt()
    {
        await ImportForCorrection("Imported med notat");
        var imported = await Own("Imported med notat");

        var noteResponse = await ChangeNote(imported.Id, "Disputed");

        Assert.Equal(HttpStatusCode.OK, noteResponse.StatusCode);
        Assert.Equal("Disputed", (await Own("Imported med notat")).Note);
    }

    [Fact]
    public async Task Put_Note_BlankOrNull_ClearsIt()
    {
        var response = await _client.PostAsJsonAsync(
            "/api/transactions", ValidRequest with { Date = "2044-01-20", Description = "Med notat", Note = "Old note" });
        var transaction = (await response.Content.ReadFromJsonAsync<TransactionResponse>())!;

        await ChangeNote(transaction.Id, "   ");

        Assert.Null((await Own("Med notat")).Note);
    }

    [Fact]
    public async Task Put_Note_ThatIsTooLong_IsRejected()
    {
        var response = await _client.PostAsJsonAsync(
            "/api/transactions", ValidRequest with { Date = "2044-01-20", Description = "Notat for langt" });
        var transaction = (await response.Content.ReadFromJsonAsync<TransactionResponse>())!;

        var noteResponse = await ChangeNote(transaction.Id, new string('x', 257));

        Assert.Equal(HttpStatusCode.BadRequest, noteResponse.StatusCode);
        var problem = await noteResponse.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        Assert.Contains("note", problem!.Errors.Keys);
    }

    [Fact]
    public async Task Put_Note_OnUnknownTransaction_ReturnsNotFound()
    {
        var noteResponse = await ChangeNote(int.MaxValue, "test");

        Assert.Equal(HttpStatusCode.NotFound, noteResponse.StatusCode);
    }

    private async Task<List<PossibleDuplicateResponse>> PossibleDuplicates(string date, string amount) =>
        (await _client.GetFromJsonAsync<List<PossibleDuplicateResponse>>(
            $"/api/transactions/possible-duplicates?date={date}&amount={amount}"))!;

    [Fact]
    public async Task Get_PossibleDuplicates_AreThoseUpToThreeDaysEitherWayOrderedByDate()
    {
        await AddManualTransaction("2047-03-06", "four days after");
        await AddManualTransaction("2047-03-05", "three days after");
        await AddManualTransaction("2047-03-02", "same day");
        await AddManualTransaction("2047-02-27", "three days before");
        await AddManualTransaction("2047-02-26", "four days before");

        var duplicates = await PossibleDuplicates("2047-03-02", "-249.90");

        Assert.Equal(
            [
                (new DateOnly(2047, 2, 27), "three days before", -249.90m),
                (new DateOnly(2047, 3, 2), "same day", -249.90m),
                (new DateOnly(2047, 3, 5), "three days after", -249.90m),
            ],
            duplicates.Select(d => (d.Date, d.Description, d.Amount)));
        Assert.All(duplicates, d => Assert.True(d.Id > 0));
    }

    [Fact]
    public async Task Get_PossibleDuplicates_IncludeImportedAndManuallyEnteredTransactions()
    {
        // Each imported row is a purchase of 10,00.
        await ImportStatement("01.05.2047 - 31.05.2047", ("0905", "imported"));
        await _client.PostAsJsonAsync(
            "/api/transactions", ValidRequest with { Date = "2047-05-11", Description = "manual", Amount = -10m });

        var duplicates = await PossibleDuplicates("2047-05-10", "-10");

        Assert.Equal(["imported", "manual"], duplicates.Select(d => d.Description));
    }

    [Fact]
    public async Task Get_PossibleDuplicates_RequiresTheExactSignedAmount()
    {
        await AddManualTransaction("2047-07-15", "spent");
        await _client.PostAsJsonAsync(
            "/api/transactions", ValidRequest with { Date = "2047-07-15", Description = "received", Amount = 249.90m });
        await _client.PostAsJsonAsync(
            "/api/transactions", ValidRequest with { Date = "2047-07-15", Description = "a cent more", Amount = -249.91m });

        var duplicates = await PossibleDuplicates("2047-07-15", "-249.9");

        Assert.Equal(["spent"], duplicates.Select(d => d.Description));
    }

    [Fact]
    public async Task Get_PossibleDuplicates_WhenThereAreNone_ReturnsEmptyList()
    {
        var duplicates = await _client.GetFromJsonAsync<List<PossibleDuplicateResponse>>(
            "/api/transactions/possible-duplicates?date=2047-09-15&amount=-12345.67");

        Assert.Empty(duplicates!);
    }

    [Theory]
    [InlineData("amount=-10", "date")]
    [InlineData("date=&amount=-10", "date")]
    [InlineData("date=soon&amount=-10", "date")]
    [InlineData("date=2047-02-30&amount=-10", "date")]
    [InlineData("date=15.09.2047&amount=-10", "date")]
    [InlineData("date=0001-01-01&amount=-10", "date")]
    [InlineData("date=3000-01-01&amount=-10", "date")]
    [InlineData("date=2047-09-15", "amount")]
    [InlineData("date=2047-09-15&amount=lots", "amount")]
    [InlineData("date=2047-09-15&amount=-249,90", "amount")]
    [InlineData("date=2047-09-15&amount=0", "amount")]
    [InlineData("date=2047-09-15&amount=-10.005", "amount")]
    [InlineData("date=2047-09-15&amount=-10000000000", "amount")]
    public async Task Get_PossibleDuplicates_InvalidDateOrAmount_IsRejected(string query, string field)
    {
        var response = await _client.GetAsync($"/api/transactions/possible-duplicates?{query}");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        Assert.Equal([field], problem!.Errors.Keys);
    }
}
