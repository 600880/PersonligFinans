using PersonligFinans.Api.BankStatements;
using PersonligFinans.Api.Categories;
using PersonligFinans.Api.CategorizationRules;
using PersonligFinans.Api.Data;
using PersonligFinans.Api.Receipts;
using PersonligFinans.Api.Spending;
using PersonligFinans.Api.Transactions;
using PersonligFinans.Api.Users;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDatabase(builder.Configuration);
builder.Services.AddRuleGenerator(builder.Configuration);
builder.Services.AddUsers();
builder.Services.AddAntiforgeryTokens();

var app = builder.Build();

// Single-instance app, so migrating on startup is safe in every environment.
await app.MigrateDatabaseAsync();

app.UseHttpsRedirection();

// In production the built client is copied into wwwroot and served by the API.
app.UseDefaultFiles();
app.UseStaticFiles();

// After the static files, so the client's files are served to anyone and the landing page can load.
// Every endpoint then requires signing in unless it allows anonymous access.
app.UseAuthentication();
app.UseAuthorization();
// After signing in is checked, since a token is bound to the signed-in User.
app.UseAntiforgery();

app.MapGet("/health", () => Results.Ok(new { status = "ok" })).AllowAnonymous();
app.MapUserEndpoints();
app.MapAntiforgeryTokenEndpoint();
app.MapTransactionEndpoints();
app.MapCategoryEndpoints();
app.MapBankStatementEndpoints();
app.MapCategorizationRuleEndpoints();
app.MapReceiptEndpoints();
app.MapSpendingEndpoints();
app.MapFallback("/api/{**path}", () => Results.NotFound());
app.MapFallbackToFile("index.html").AllowAnonymous();

app.Run();

public partial class Program;
