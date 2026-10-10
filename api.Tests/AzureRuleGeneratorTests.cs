using System.ClientModel;
using System.ClientModel.Primitives;
using System.Diagnostics;
using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using OpenAI;
using OpenAI.Chat;
using PersonligFinans.Api.CategorizationRules;

namespace PersonligFinans.Api.Tests;

// The Azure rule generator against a faked HTTP layer: it never calls Azure.
public class AzureRuleGeneratorTests
{
    private static readonly UnmatchedRow Bakery = new("Bakeriet Lille Bergen", AmountSign.Negative);
    private static readonly UnmatchedRow Vipps = new("Vipps *Ola Nordmann", AmountSign.Negative);
    private static readonly UnmatchedRow Salary = new("Lønn Arbeidsgiver AS", AmountSign.Positive);
    private static readonly string[] CategoryNames = ["Groceries", "Income", "Restaurants"];

    // Answers every request with the given response, and remembers the request bodies.
    private sealed class FakeHandler(Func<CancellationToken, Task<HttpResponseMessage>> respond) : HttpMessageHandler
    {
        public List<string> RequestBodies { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            RequestBodies.Add(await request.Content!.ReadAsStringAsync(cancellationToken));
            return await respond(cancellationToken);
        }
    }

    private static FakeHandler Answering(HttpStatusCode status, string body) =>
        new(_ => Task.FromResult(new HttpResponseMessage(status)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        }));

    // A chat completion whose message is the given content, as the model wrote it.
    private static FakeHandler AnsweringWithContent(string content) =>
        Answering(HttpStatusCode.OK, new JsonObject
        {
            ["id"] = "chatcmpl-1",
            ["object"] = "chat.completion",
            ["created"] = 0,
            ["model"] = "gpt-4.1-mini",
            ["choices"] = new JsonArray(new JsonObject
            {
                ["index"] = 0,
                ["message"] = new JsonObject { ["role"] = "assistant", ["content"] = content },
                ["finish_reason"] = "stop",
            }),
        }.ToJsonString());

    private static AzureRuleGenerator Generator(HttpMessageHandler handler, TimeSpan? timeLimit = null)
    {
        var options = new OpenAIClientOptions
        {
            Endpoint = new Uri("https://example.invalid/openai/v1/"),
            Transport = new HttpClientPipelineTransport(new HttpClient(handler)),
            RetryPolicy = new ClientRetryPolicy(maxRetries: 0),
        };
        var chat = new ChatClient("gpt-4.1-mini", new ApiKeyCredential("test"), options);
        return new AzureRuleGenerator(chat, NullLogger<AzureRuleGenerator>.Instance, timeLimit);

    }

    [Fact]
    public async Task Generate_ValidResponse_ReturnsAProposalForEachRowNotDeclined()
    {
        var handler = AnsweringWithContent("""
            {"rows": [
              {"index": 0, "keyword": "bakeriet", "category": "Restaurants"},
              {"index": 1, "keyword": null, "category": null},
              {"index": 2, "keyword": "arbeidsgiver", "category": "Income"}
            ]}
            """);

        var result = await Generator(handler).GenerateAsync([Bakery, Vipps, Salary], CategoryNames);

        var generated = Assert.IsType<RuleGeneration.Generated>(result);
        Assert.Equal(
            new Dictionary<UnmatchedRow, RuleProposal>
            {
                [Bakery] = new("bakeriet", "Restaurants"),
                [Salary] = new("arbeidsgiver", "Income"),
            },
            generated.Proposals);
    }

    [Fact]
    public async Task Generate_AllRowsDeclined_ReturnsNoProposals()
    {
        var handler = AnsweringWithContent("""{"rows": [{"index": 0, "keyword": null, "category": null}]}""");

        var result = await Generator(handler).GenerateAsync([Vipps], CategoryNames);

        Assert.Empty(Assert.IsType<RuleGeneration.Generated>(result).Proposals);
    }

    [Fact]
    public async Task Generate_EntriesForUnknownRowsOrMissingAKeywordOrCategory_AreIgnored()
    {
        var handler = AnsweringWithContent("""
            {"rows": [
              {"index": 7, "keyword": "bakeriet", "category": "Restaurants"},
              {"index": -1, "keyword": "vipps", "category": "Other"},
              {"index": 0, "keyword": "bakeriet", "category": null},
              {"index": 1, "keyword": " ", "category": "Restaurants"},
              {"index": 2, "keyword": "arbeidsgiver", "category": "Income"},
              {"index": 2, "keyword": "lønn", "category": "Groceries"}
            ]}
            """);

        var result = await Generator(handler).GenerateAsync([Bakery, Vipps, Salary], CategoryNames);

        var proposal = Assert.Single(Assert.IsType<RuleGeneration.Generated>(result).Proposals);
        Assert.Equal((Salary, new RuleProposal("arbeidsgiver", "Income")), (proposal.Key, proposal.Value));
    }

    [Theory]
    [InlineData("I can't help with that.")]
    [InlineData("""{"rows": [{"index": 0, "keyword": "bakeriet", "categ""")]
    [InlineData("{}")]
    [InlineData("""{"rows": null}""")]
    [InlineData("""{"rows": [{"keyword": "bakeriet", "category": "Restaurants"}]}""")]
    [InlineData("""{"rows": [{"index": "first", "keyword": "bakeriet", "category": "Restaurants"}]}""")]
    [InlineData("")]
    public async Task Generate_MalformedOrPartialResponse_IsUnavailable(string content)
    {
        var result = await Generator(AnsweringWithContent(content)).GenerateAsync([Bakery], CategoryNames);

        Assert.IsType<RuleGeneration.Unavailable>(result);
    }

    [Fact]
    public async Task Generate_ResponseThatIsNotAChatCompletion_IsUnavailable()
    {
        var result = await Generator(Answering(HttpStatusCode.OK, "<html>Bad gateway</html>"))
            .GenerateAsync([Bakery], CategoryNames);

        Assert.IsType<RuleGeneration.Unavailable>(result);
    }

    [Theory]
    [InlineData(HttpStatusCode.TooManyRequests)]
    [InlineData(HttpStatusCode.InternalServerError)]
    [InlineData(HttpStatusCode.Unauthorized)]
    [InlineData(HttpStatusCode.Forbidden)]
    public async Task Generate_ErrorStatus_IsUnavailable(HttpStatusCode status)
    {
        var handler = Answering(status, """{"error": {"code": "error", "message": "Failed."}}""");

        var result = await Generator(handler).GenerateAsync([Bakery], CategoryNames);

        Assert.IsType<RuleGeneration.Unavailable>(result);
    }

    [Fact]
    public async Task Generate_NetworkError_IsUnavailable()
    {
        var handler = new FakeHandler(_ => throw new HttpRequestException("No route to host."));

        var result = await Generator(handler).GenerateAsync([Bakery], CategoryNames);

        Assert.IsType<RuleGeneration.Unavailable>(result);
    }

    [Fact]
    public async Task Generate_NoResponseWithinTheTimeLimit_IsUnavailable()
    {
        var handler = new FakeHandler(async cancellationToken =>
        {
            await Task.Delay(Timeout.Infinite, cancellationToken);
            throw new UnreachableException();
        });

        var result = await Generator(handler, TimeSpan.FromMilliseconds(200)).GenerateAsync([Bakery], CategoryNames);

        Assert.IsType<RuleGeneration.Unavailable>(result);
    }

    [Fact]
    public async Task Generate_MakesOneCallSendingOnlyTheDescriptionsSignsAndCategoryNames()
    {
        var handler = AnsweringWithContent("""{"rows": []}""");

        await Generator(handler).GenerateAsync([Bakery, Salary], CategoryNames);

        var request = JsonNode.Parse(Assert.Single(handler.RequestBodies))!;
        Assert.Equal("gpt-4.1-mini", (string?)request["model"]);
        Assert.Equal("json_schema", (string?)request["response_format"]?["type"]);
        var userMessage = request["messages"]!.AsArray().Single(m => (string?)m!["role"] == "user")!;
        var expected = JsonNode.Parse("""
            {
              "categories": ["Groceries", "Income", "Restaurants"],
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
    public async Task Generate_TellsTheModelADeclinedRowIsPutInOtherWhichItCannotChoose()
    {
        var handler = AnsweringWithContent("""{"rows": []}""");

        await Generator(handler).GenerateAsync([Bakery], CategoryNames);

        var request = JsonNode.Parse(Assert.Single(handler.RequestBodies))!;
        var systemMessage = request["messages"]!.AsArray().Single(m => (string?)m!["role"] == "system")!;
        Assert.Contains("put in the \"Other\" category", (string)systemMessage["content"]!);
        var categoryEnum = request["response_format"]!["json_schema"]!["schema"]!
            ["properties"]!["rows"]!["items"]!["properties"]!["category"]!["enum"]!.AsArray();
        Assert.Equal(["Groceries", "Income", "Restaurants", null], categoryEnum.Select(c => (string?)c));
    }

    [Fact]
    public void AddRuleGenerator_WithoutAnEndpoint_RegistersNoRuleGenerator()
    {
        var services = Services(new() { ["RuleGenerator:Deployment"] = "gpt-4.1-mini" });

        Assert.Null(services.GetService<IRuleGenerator>());
    }

    [Fact]
    public void AddRuleGenerator_WithAnEndpointAndDeployment_RegistersTheAzureRuleGenerator()
    {
        var services = Services(new()
        {
            ["RuleGenerator:Endpoint"] = "https://example.invalid/",
            ["RuleGenerator:Deployment"] = "gpt-4.1-mini",
        });

        Assert.IsType<AzureRuleGenerator>(services.GetService<IRuleGenerator>());
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
