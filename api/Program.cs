using PersonligFinans.Api.BankStatements;
using PersonligFinans.Api.Data;
using PersonligFinans.Api.Transactions;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDatabase(builder.Configuration);

var app = builder.Build();

// Single-instance app, so migrating on startup is safe in every environment.
app.MigrateDatabase();

app.UseHttpsRedirection();

// In production the built client is copied into wwwroot and served by the API.
app.UseDefaultFiles();
app.UseStaticFiles();

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));
app.MapTransactionEndpoints();
app.MapBankStatementEndpoints();
app.MapFallback("/api/{**path}", () => Results.NotFound());
app.MapFallbackToFile("index.html");

app.Run();

public partial class Program;
