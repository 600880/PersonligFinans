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
public class TransactionEndpointsTests
{
    private const int GroceriesCategoryId = 1;
    private const int RestaurantsCategoryId = 2;
    private const int ShoppingCategoryId = 8;
    private const int OtherCategoryId = 13;
    private const int ClothingCategoryId = 14;
    private const int ElectronicsCategoryId = 15;

    private readonly PostgresApiFactory _factory;
    private readonly HttpClient _client;

    // The tests share one database, so the listing tests use years no other test uses and put a
    // token of their own in each description. The correction tests also put it in each rule's
    // keyword, so their rules match only their own Transactions.
    private readonly string _token = "t" + Guid.NewGuid().ToString("N")[..8];

    public TransactionEndpointsTests(PostgresApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    private static object ValidRequest(
        string? date = "2026-09-24",
        string? description = "Rema 1000",
        decimal? amount = -249.90m,
        string? note = null,
        int? categoryId = OtherCategoryId) =>
        new { date, description, amount, note, categoryId };

    private async Task<Dictionary<string, string[]>> PostExpectingValidationErrors(object request)
    {
        var response = await _client.PostAsJsonAsync("/api/transactions", request);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        return new Dictionary<string, string[]>(problem!.Errors);
    }

    [Fact]
    public async Task Get_Categories_ReturnsSeededList()
    {
        var categories = (await _client.GetFromJsonAsync<List<CategoryResponse>>("/api/categories"))!;

        // Other tests add Categories of their own, so only the seeded ones are checked.
        Assert.Contains(categories, c => c.Name == "Groceries");
        Assert.Contains(categories, c => c is { Id: OtherCategoryId, Name: "Other" });
        Assert.Contains(categories, c => c is { Id: ClothingCategoryId, Name: "Clothing" });
        Assert.Contains(categories, c => c is { Id: ElectronicsCategoryId, Name: "Electronics" });
    }

    [Fact]
    public async Task Post_ValidTransaction_StoresItAndReturnsCreated()
    {
        var response = await _client.PostAsJsonAsync(
            "/api/transactions",
            ValidRequest(description: "  Invoice 42 paid  ", amount: 1500m, note: "INV-42"));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<TransactionResponse>();

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var stored = await db.Transactions.SingleAsync(t => t.Id == created!.Id);
        Assert.Equal(new DateOnly(2026, 9, 24), stored.PostedDate);
        Assert.Equal("Invoice 42 paid", stored.Description);
        Assert.Equal(1500m, stored.Amount);
        Assert.Equal("INV-42", stored.Note);
        Assert.Equal(OtherCategoryId, stored.CategoryId);
        Assert.Null(stored.BankStatementId);
    }

    [Fact]
    public async Task Post_BlankNote_IsStoredAsNull()
    {
        var response = await _client.PostAsJsonAsync("/api/transactions", ValidRequest(note: "   "));

        var created = await response.Content.ReadFromJsonAsync<TransactionResponse>();
        Assert.Null(created!.Note);
    }

    [Fact]
    public async Task Post_MissingFields_ReturnsErrorPerField()
    {
        var errors = await PostExpectingValidationErrors(
            ValidRequest(date: null, description: " ", amount: null, categoryId: null));

        Assert.Equal(["amount", "categoryId", "date", "description"], errors.Keys.Order());
    }

    [Fact]
    public async Task Post_ZeroAmount_IsRejected()
    {
        var errors = await PostExpectingValidationErrors(ValidRequest(amount: 0m));

        Assert.Contains("amount", errors.Keys);
    }

    [Fact]
    public async Task Post_AmountWithMoreThanTwoDecimals_IsRejected()
    {
        var errors = await PostExpectingValidationErrors(ValidRequest(amount: 10.005m));

        Assert.Contains("amount", errors.Keys);
    }

    [Fact]
    public async Task Post_UnknownCategory_IsRejected()
    {
        var errors = await PostExpectingValidationErrors(ValidRequest(categoryId: 9999));

        Assert.Contains("categoryId", errors.Keys);
    }

    [Fact]
    public async Task Post_TooLongDescriptionAndNote_AreRejected()
    {
        var errors = await PostExpectingValidationErrors(
            ValidRequest(description: new string('x', 201), note: new string('x', 257)));

        Assert.Contains("description", errors.Keys);
        Assert.Contains("note", errors.Keys);
    }

    private async Task AddManualTransaction(string date, string description)
    {
        var response = await _client.PostAsJsonAsync(
            "/api/transactions",
            ValidRequest(date: date, description: description));
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
        using var client = api.CreateClient();
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

    private async Task<List<TransactionResponse>> OwnTransactionsOf(int year, int month)
    {
        var transactions = await _client.GetFromJsonAsync<List<TransactionResponse>>(
            $"/api/transactions?year={year}&month={month}");
        return transactions!.Where(t => t.Description.StartsWith(_token)).ToList();
    }

    [Fact]
    public async Task Get_Months_ListsEachMonthWithTransactionsOnceNewestFirst()
    {
        await AddManualTransaction("2041-03-05", $"{_token} manual");
        await AddManualTransaction("2041-03-20", $"{_token} manual again");
        await ImportStatement("01.05.2041 - 31.05.2041", ("0405", $"{_token} imported"));

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
        await AddManualTransaction("2042-01-31", $"{_token} day before");
        await AddManualTransaction("2042-02-01", $"{_token} first day");
        await AddManualTransaction("2042-02-14", $"{_token} manual mid");
        await AddManualTransaction("2042-03-01", $"{_token} day after");
        // Imported after the manual one on the same date, so it has the higher id.
        await ImportStatement(
            "01.02.2042 - 28.02.2042",
            ("1402", $"{_token} imported mid"),
            ("2802", $"{_token} last day"));

        var transactions = await OwnTransactionsOf(2042, 2);

        Assert.Equal(
            [
                (new DateOnly(2042, 2, 28), $"{_token} last day", -10m, (int?)null),
                (new DateOnly(2042, 2, 14), $"{_token} imported mid", -10m, null),
                (new DateOnly(2042, 2, 14), $"{_token} manual mid", -249.90m, OtherCategoryId),
                (new DateOnly(2042, 2, 1), $"{_token} first day", -249.90m, OtherCategoryId),
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
        await AddManualTransaction("2045-12-31", $"{_token} last day");
        await AddManualTransaction("2044-12-31", $"{_token} day before");
        await AddManualTransaction("2045-06-15", $"{_token} mid");
        await AddManualTransaction("2045-01-01", $"{_token} first day");
        await AddManualTransaction("2046-01-01", $"{_token} day after");

        var transactions = await _client.GetFromJsonAsync<List<TransactionResponse>>("/api/transactions?year=2045");

        Assert.Equal(
            [$"{_token} last day", $"{_token} mid", $"{_token} first day"],
            transactions!.Where(t => t.Description.StartsWith(_token)).Select(t => t.Description));
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

    // The correction tests import into a month no other test uses.
    private const string CorrectionPeriod = "01.01.2044 - 31.01.2044";

    private Task ImportForCorrection(params string[] descriptions) =>
        ImportStatement(CorrectionPeriod, descriptions.Select(d => ("1501", $"{_token} {d}")).ToArray());

    private Task ImportForCorrection(IRuleGenerator ruleGenerator, params string[] descriptions) =>
        ImportStatement(ruleGenerator, CorrectionPeriod, descriptions.Select(d => ("1501", $"{_token} {d}")).ToArray());

    // This test's Transaction with the given description, as the month's list shows it.
    private async Task<TransactionResponse> Own(string description) =>
        (await OwnTransactionsOf(2044, 1)).Single(t => t.Description == $"{_token} {description}");

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

        var changed = await CategoryChanged(imported.Id, RestaurantsCategoryId);

        Assert.Equal(imported with { CategoryId = RestaurantsCategoryId, Locked = true }, changed);
        Assert.Equal(RestaurantsCategoryId, (await Own("Kafé")).CategoryId);
    }

    [Fact]
    public async Task Put_Category_CorrectedImportedTransactionKeepsItWhenAMatchingRuleIsAdded()
    {
        await ImportForCorrection("Kafé Nord", "Kafé Sør");
        await CategoryChanged((await Own("Kafé Nord")).Id, RestaurantsCategoryId);

        await AddRule($"{_token} kafé", GroceriesCategoryId);

        Assert.Equal(RestaurantsCategoryId, (await Own("Kafé Nord")).CategoryId);
        Assert.Equal(GroceriesCategoryId, (await Own("Kafé Sør")).CategoryId);
    }

    [Fact]
    public async Task Put_Category_CorrectedImportedTransactionKeepsItWhenTheRuleThatCategorizedItIsEdited()
    {
        var ruleId = await AddRule($"{_token} kafé", GroceriesCategoryId);
        await ImportForCorrection("Kafé Nord", "Kafé Sør");
        await CategoryChanged((await Own("Kafé Nord")).Id, RestaurantsCategoryId);

        var response = await _client.PutAsJsonAsync(
            $"/api/categorization-rules/{ruleId}", new { keyword = $"{_token} kafé", categoryId = ShoppingCategoryId });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(RestaurantsCategoryId, (await Own("Kafé Nord")).CategoryId);
        Assert.Equal(ShoppingCategoryId, (await Own("Kafé Sør")).CategoryId);
    }

    [Fact]
    public async Task Put_Category_CorrectedImportedTransactionKeepsItWhenTheRuleThatCategorizedItIsDeleted()
    {
        var ruleId = await AddRule($"{_token} kafé", GroceriesCategoryId);
        await ImportForCorrection("Kafé Nord", "Kafé Sør");
        await CategoryChanged((await Own("Kafé Nord")).Id, RestaurantsCategoryId);

        var response = await _client.DeleteAsync($"/api/categorization-rules/{ruleId}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(RestaurantsCategoryId, (await Own("Kafé Nord")).CategoryId);
        Assert.Null((await Own("Kafé Sør")).CategoryId);
    }

    [Fact]
    public async Task Put_Category_CorrectedImportedTransactionKeepsItWhenALaterImportsAiGeneratedRuleMatchesIt()
    {
        await ImportForCorrection("Kafé Nord");
        await CategoryChanged((await Own("Kafé Nord")).Id, ShoppingCategoryId);
        var generator = new FakeRuleGenerator().Proposing($"{_token} Kafé Sør", $"{_token} kafé", "Restaurants");

        await ImportForCorrection(generator, "Kafé Sør");

        var rule = Assert.Single(await Rules(), r => r.Keyword == $"{_token} kafé");
        Assert.True(rule.AiGenerated);
        Assert.Equal(RestaurantsCategoryId, (await Own("Kafé Sør")).CategoryId);
        Assert.Equal(ShoppingCategoryId, (await Own("Kafé Nord")).CategoryId);
    }

    [Fact]
    public async Task Put_Category_CreatesNoRuleAndLeavesTheRulesUnchanged()
    {
        await AddRule($"{_token} kafé", GroceriesCategoryId);
        await ImportForCorrection("Kafé Nord", "Frisør");
        var before = await Rules();

        await CategoryChanged((await Own("Kafé Nord")).Id, RestaurantsCategoryId);
        await CategoryChanged((await Own("Frisør")).Id, ShoppingCategoryId);

        Assert.Equal(before, await Rules());
    }

    [Fact]
    public async Task Put_Category_OfTransactionCategorizedByAnAiGeneratedRule_ChangesItAndLeavesTheRuleUnchanged()
    {
        var generator = new FakeRuleGenerator().Proposing($"{_token} Kafé", $"{_token} kafé", "Restaurants");
        await ImportForCorrection(generator, "Kafé");
        var rule = Assert.Single(await Rules(), r => r.Keyword == $"{_token} kafé");
        Assert.True(rule.AiGenerated);
        Assert.Equal(RestaurantsCategoryId, (await Own("Kafé")).CategoryId);

        await CategoryChanged((await Own("Kafé")).Id, GroceriesCategoryId);

        Assert.Equal(GroceriesCategoryId, (await Own("Kafé")).CategoryId);
        Assert.Equal(rule, Assert.Single(await Rules(), r => r.Keyword == $"{_token} kafé"));
    }

    [Fact]
    public async Task Put_Category_OfManualTransaction_ChangesOnlyItsCategory()
    {
        var response = await _client.PostAsJsonAsync(
            "/api/transactions",
            ValidRequest(date: "2044-01-20", description: $"{_token} Lunsj", note: "INV-7"));
        var manual = (await response.Content.ReadFromJsonAsync<TransactionResponse>())!;

        await CategoryChanged(manual.Id, GroceriesCategoryId);
        var changed = await CategoryChanged(manual.Id, RestaurantsCategoryId);

        Assert.Equal(manual with { CategoryId = RestaurantsCategoryId }, changed);
        Assert.Equal(changed, await Own("Lunsj"));
    }

    [Fact]
    public async Task Put_Category_Other_CanBeChosen()
    {
        await ImportForCorrection("Kafé");

        var changed = await CategoryChanged((await Own("Kafé")).Id, OtherCategoryId);

        Assert.Equal(OtherCategoryId, changed.CategoryId);
        Assert.Equal(OtherCategoryId, (await Own("Kafé")).CategoryId);
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
        await AddRule($"{_token} kafé", RestaurantsCategoryId);
        await ImportForCorrection("Kafé");

        var categorized = await Own("Kafé");

        Assert.Equal((RestaurantsCategoryId, false), (categorized.CategoryId, categorized.Locked));
    }

    [Fact]
    public async Task Post_ManuallyEnteredTransaction_IsLocked()
    {
        var response = await _client.PostAsJsonAsync(
            "/api/transactions", ValidRequest(date: "2044-01-20", description: $"{_token} Lunsj"));

        var created = (await response.Content.ReadFromJsonAsync<TransactionResponse>())!;
        Assert.True(created.Locked);
        Assert.True((await Own("Lunsj")).Locked);
    }

    [Fact]
    public async Task Put_Category_OfTransactionCategorizedByARule_LocksIt()
    {
        await AddRule($"{_token} kafé", RestaurantsCategoryId);
        await ImportForCorrection("Kafé");

        var changed = await CategoryChanged((await Own("Kafé")).Id, GroceriesCategoryId);

        Assert.True(changed.Locked);
        Assert.Equal(changed, await Own("Kafé"));
    }

    [Fact]
    public async Task Put_Category_OfUnknownTransaction_ReturnsNotFound()
    {
        var response = await ChangeCategory(int.MaxValue, GroceriesCategoryId);

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
        await AddManualTransaction("2044-01-10", $"{_token} manual");
        await ImportForCorrection("imported");

        Assert.False((await Own("manual")).Imported);
        Assert.True((await Own("imported")).Imported);
    }

    [Fact]
    public async Task Delete_ManualTransaction_RemovesIt()
    {
        await AddManualTransaction("2044-01-10", $"{_token} manual");

        var response = await _client.DeleteAsync($"/api/transactions/{(await Own("manual")).Id}");

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Empty(await OwnTransactionsOf(2044, 1));
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
            "/api/transactions", ValidRequest(date: "2044-01-20", description: $"{_token} Kvittering"));
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
            "/api/transactions", ValidRequest(date: "2044-01-20", description: $"{_token} Med notat", note: "Old note"));
        var transaction = (await response.Content.ReadFromJsonAsync<TransactionResponse>())!;

        await ChangeNote(transaction.Id, "   ");

        Assert.Null((await Own("Med notat")).Note);
    }

    [Fact]
    public async Task Put_Note_ThatIsTooLong_IsRejected()
    {
        var response = await _client.PostAsJsonAsync(
            "/api/transactions", ValidRequest(date: "2044-01-20", description: $"{_token} Notat for langt"));
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

    // The Possible duplicate tests use dates in 2047, which no other test uses, and only look at
    // their own Transactions, except for the one asking about an Amount no test enters.
    private async Task<List<PossibleDuplicateResponse>> OwnPossibleDuplicates(string date, string amount)
    {
        var duplicates = await _client.GetFromJsonAsync<List<PossibleDuplicateResponse>>(
            $"/api/transactions/possible-duplicates?date={date}&amount={amount}");
        return duplicates!.Where(d => d.Description.StartsWith(_token)).ToList();
    }

    [Fact]
    public async Task Get_PossibleDuplicates_AreThoseUpToThreeDaysEitherWayOrderedByDate()
    {
        await AddManualTransaction("2047-03-06", $"{_token} four days after");
        await AddManualTransaction("2047-03-05", $"{_token} three days after");
        await AddManualTransaction("2047-03-02", $"{_token} same day");
        await AddManualTransaction("2047-02-27", $"{_token} three days before");
        await AddManualTransaction("2047-02-26", $"{_token} four days before");

        var duplicates = await OwnPossibleDuplicates("2047-03-02", "-249.90");

        Assert.Equal(
            [
                (new DateOnly(2047, 2, 27), $"{_token} three days before", -249.90m),
                (new DateOnly(2047, 3, 2), $"{_token} same day", -249.90m),
                (new DateOnly(2047, 3, 5), $"{_token} three days after", -249.90m),
            ],
            duplicates.Select(d => (d.Date, d.Description, d.Amount)));
        Assert.All(duplicates, d => Assert.True(d.Id > 0));
    }

    [Fact]
    public async Task Get_PossibleDuplicates_IncludeImportedAndManuallyEnteredTransactions()
    {
        // Each imported row is a purchase of 10,00.
        await ImportStatement("01.05.2047 - 31.05.2047", ("0905", $"{_token} imported"));
        await _client.PostAsJsonAsync(
            "/api/transactions", ValidRequest(date: "2047-05-11", description: $"{_token} manual", amount: -10m));

        var duplicates = await OwnPossibleDuplicates("2047-05-10", "-10");

        Assert.Equal([$"{_token} imported", $"{_token} manual"], duplicates.Select(d => d.Description));
    }

    [Fact]
    public async Task Get_PossibleDuplicates_RequiresTheExactSignedAmount()
    {
        await AddManualTransaction("2047-07-15", $"{_token} spent");
        await _client.PostAsJsonAsync(
            "/api/transactions", ValidRequest(date: "2047-07-15", description: $"{_token} received", amount: 249.90m));
        await _client.PostAsJsonAsync(
            "/api/transactions", ValidRequest(date: "2047-07-15", description: $"{_token} a cent more", amount: -249.91m));

        var duplicates = await OwnPossibleDuplicates("2047-07-15", "-249.9");

        Assert.Equal([$"{_token} spent"], duplicates.Select(d => d.Description));
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
