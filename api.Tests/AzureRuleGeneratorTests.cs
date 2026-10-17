using System.Diagnostics;
using System.Net;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using PersonligFinans.Api.CategorizationRules;
using PersonligFinans.Api.Receipts;

namespace PersonligFinans.Api.Tests;

// The Azure rule generator against a faked HTTP layer: it never calls Azure.
public class AzureRuleGeneratorTests
{
    private static readonly UnmatchedRow Bakery = new("Bakeriet Lille Bergen", AmountSign.Negative);
    private static readonly UnmatchedRow Kitchn = new("kitch n Netthandel", AmountSign.Negative);
    private static readonly UnmatchedRow Salary = new("Lønn Arbeidsgiver AS", AmountSign.Positive);
    private static readonly CategoryChoice[] Categories =
    [
        new("Groceries", "All groceries."),
        new("Income", "All income."),
        new("Other", "Everything that fits no other category."),
        new("Restaurants", "Restaurant, takeaway, bakery etc."),
    ];

    private static AzureRuleGenerator Generator(FakeChatHandler handler, TimeSpan? timeLimit = null) =>
        new(handler.Client(), NullLogger<AzureRuleGenerator>.Instance, timeLimit);

    [Fact]
    public async Task Generate_ValidResponse_ReturnsAProposalForEachRow()
    {
        var handler = FakeChatHandler.AnsweringWithContent("""
            {"rows": [
              {"index": 0, "keyword": "bakeriet", "category": "Restaurants"},
              {"index": 1, "keyword": "kitch n", "category": "Other"},
              {"index": 2, "keyword": "arbeidsgiver", "category": "Income"}
            ]}
            """);

        var result = await Generator(handler).GenerateAsync([Bakery, Kitchn, Salary], Categories);

        var generated = Assert.IsType<RuleGeneration.Generated>(result);
        Assert.Equal(
            new Dictionary<UnmatchedRow, RuleProposal>
            {
                [Bakery] = new("bakeriet", "Restaurants"),
                [Kitchn] = new("kitch n", "Other"),
                [Salary] = new("arbeidsgiver", "Income"),
            },
            generated.Proposals);
    }

    [Fact]
    public async Task Generate_EntriesForUnknownRowsOrABlankKeyword_AreIgnored()
    {
        var handler = FakeChatHandler.AnsweringWithContent("""
            {"rows": [
              {"index": 7, "keyword": "bakeriet", "category": "Restaurants"},
              {"index": -1, "keyword": "kitch n", "category": "Other"},
              {"index": 0, "keyword": " ", "category": "Restaurants"},
              {"index": 1, "keyword": "", "category": "Other"},
              {"index": 2, "keyword": "arbeidsgiver", "category": "Income"},
              {"index": 2, "keyword": "lønn", "category": "Groceries"}
            ]}
            """);

        var result = await Generator(handler).GenerateAsync([Bakery, Kitchn, Salary], Categories);

        var proposal = Assert.Single(Assert.IsType<RuleGeneration.Generated>(result).Proposals);
        Assert.Equal((Salary, new RuleProposal("arbeidsgiver", "Income")), (proposal.Key, proposal.Value));
    }

    [Theory]
    [InlineData("I can't help with that.")]
    [InlineData("""{"rows": [{"index": 0, "keyword": "bakeriet", "categ""")]
    [InlineData("{}")]
    [InlineData("""{"rows": null}""")]
    [InlineData("""{"rows": [{"keyword": "bakeriet", "category": "Restaurants"}]}""")]
    [InlineData("""{"rows": [{"index": 0, "keyword": null, "category": null}]}""")]
    [InlineData("""{"rows": [{"index": 0, "keyword": "bakeriet", "category": null}]}""")]
    [InlineData("""{"rows": [{"index": "first", "keyword": "bakeriet", "category": "Restaurants"}]}""")]
    [InlineData("")]
    public async Task Generate_MalformedOrPartialResponse_IsUnavailable(string content)
    {
        var result = await Generator(FakeChatHandler.AnsweringWithContent(content)).GenerateAsync([Bakery], Categories);

        Assert.IsType<RuleGeneration.Unavailable>(result);
    }

    [Fact]
    public async Task Generate_ResponseThatIsNotAChatCompletion_IsUnavailable()
    {
        var result = await Generator(FakeChatHandler.Answering(HttpStatusCode.OK, "<html>Bad gateway</html>"))
            .GenerateAsync([Bakery], Categories);

        Assert.IsType<RuleGeneration.Unavailable>(result);
    }

    [Theory]
    [InlineData(HttpStatusCode.TooManyRequests)]
    [InlineData(HttpStatusCode.InternalServerError)]
    [InlineData(HttpStatusCode.Unauthorized)]
    [InlineData(HttpStatusCode.Forbidden)]
    public async Task Generate_ErrorStatus_IsUnavailable(HttpStatusCode status)
    {
        var handler = FakeChatHandler.Answering(status, """{"error": {"code": "error", "message": "Failed."}}""");

        var result = await Generator(handler).GenerateAsync([Bakery], Categories);

        Assert.IsType<RuleGeneration.Unavailable>(result);
    }

    [Fact]
    public async Task Generate_NetworkError_IsUnavailable()
    {
        var handler = new FakeChatHandler(_ => throw new HttpRequestException("No route to host."));

        var result = await Generator(handler).GenerateAsync([Bakery], Categories);

        Assert.IsType<RuleGeneration.Unavailable>(result);
    }

    [Fact]
    public async Task Generate_NoResponseWithinTheTimeLimit_IsUnavailable()
    {
        var handler = new FakeChatHandler(async cancellationToken =>
        {
            await Task.Delay(Timeout.Infinite, cancellationToken);
            throw new UnreachableException();
        });

        var result = await Generator(handler, TimeSpan.FromMilliseconds(200)).GenerateAsync([Bakery], Categories);

        Assert.IsType<RuleGeneration.Unavailable>(result);
    }

    [Fact]
    public async Task Generate_MakesOneCallSendingOnlyTheDescriptionsSignsAndCategoryNamesAndDescriptions()
    {
        var handler = FakeChatHandler.AnsweringWithContent("""{"rows": []}""");

        await Generator(handler).GenerateAsync([Bakery, Salary], Categories);

        var request = JsonNode.Parse(Assert.Single(handler.RequestBodies))!;
        Assert.Equal("gpt-4.1-mini", (string?)request["model"]);
        Assert.Equal("json_schema", (string?)request["response_format"]?["type"]);
        var userMessage = request["messages"]!.AsArray().Single(m => (string?)m!["role"] == "user")!;
        var expected = JsonNode.Parse("""
            {
              "categories": [
                {"name": "Groceries", "description": "All groceries."},
                {"name": "Income", "description": "All income."},
                {"name": "Other", "description": "Everything that fits no other category."},
                {"name": "Restaurants", "description": "Restaurant, takeaway, bakery etc."}
              ],
              "rows": [
                {"index": 0, "description": "Bakeriet Lille Bergen", "sign": "negative"},
                {"index": 1, "description": "Lønn Arbeidsgiver AS", "sign": "positive"}
              ]
            }
            """);
        Assert.True(
            JsonNode.DeepEquals(expected, JsonNode.Parse((string)userMessage["content"]!)),
            $"Unexpected user message: {userMessage["content"]}");
    }

    [Fact]
    public async Task Generate_RequiresAKeywordAndOneOfTheGivenCategoriesForEveryRow()
    {
        var handler = FakeChatHandler.AnsweringWithContent("""{"rows": []}""");

        await Generator(handler).GenerateAsync([Bakery], Categories);

        var request = JsonNode.Parse(Assert.Single(handler.RequestBodies))!;
        var systemMessage = request["messages"]!.AsArray().Single(m => (string?)m!["role"] == "system")!;
        Assert.DoesNotContain("decline", (string)systemMessage["content"]!, StringComparison.OrdinalIgnoreCase);
        var row = request["response_format"]!["json_schema"]!["schema"]!["properties"]!["rows"]!["items"]!["properties"]!;
        Assert.Equal("string", (string?)row["keyword"]!["type"]);
        Assert.Equal("string", (string?)row["category"]!["type"]);
        Assert.Equal(
            ["Groceries", "Income", "Other", "Restaurants"],
            row["category"]!["enum"]!.AsArray().Select(c => (string?)c));
    }

    [Fact]
    public void AddRuleGenerator_WithoutAnEndpoint_RegistersNeitherTheRuleGeneratorNorTheReceiptReader()
    {
        var services = Services(new() { ["RuleGenerator:Deployment"] = "gpt-4.1-mini" });

        Assert.Null(services.GetService<IRuleGenerator>());
        Assert.Null(services.GetService<IReceiptReader>());
    }

    [Fact]
    public void AddRuleGenerator_WithAnEndpointAndDeployment_RegistersTheAzureRuleGeneratorAndReceiptReader()
    {
        var services = Services(new()
        {
            ["RuleGenerator:Endpoint"] = "https://example.invalid/",
            ["RuleGenerator:Deployment"] = "gpt-4.1-mini",
        });

        Assert.IsType<AzureRuleGenerator>(services.GetService<IRuleGenerator>());
        Assert.IsType<AzureReceiptReader>(services.GetService<IReceiptReader>());
    }

    [Fact]
    public void AddRuleGenerator_WithAnEndpointButNoDeployment_Throws() =>
        Assert.Throws<InvalidOperationException>(() =>
            Services(new() { ["RuleGenerator:Endpoint"] = "https://example.invalid/" }));

    private static ServiceProvider Services(Dictionary<string, string?> settings) =>
        new ServiceCollection()
            .AddLogging()
            .AddRuleGenerator(new ConfigurationBuilder().AddInMemoryCollection(settings).Build())
            .BuildServiceProvider();
}
