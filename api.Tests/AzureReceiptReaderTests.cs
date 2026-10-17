using System.Diagnostics;
using System.Net;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using PersonligFinans.Api.CategorizationRules;
using PersonligFinans.Api.Receipts;

namespace PersonligFinans.Api.Tests;

// The Azure receipt reader against a faked HTTP layer: it never calls Azure.
public class AzureReceiptReaderTests
{
    // The leading bytes of a JPEG, standing in for a photo of a Receipt.
    private static readonly Receipt Jpeg = new([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, .."JFIF"u8, 0x00], "image/jpeg");
    private static readonly CategoryChoice[] Categories =
    [
        new("Groceries", "All groceries."),
        new("Other", "Everything that fits no other category."),
        new("Restaurants", "Restaurant, takeaway, bakery etc."),
    ];

    private static AzureReceiptReader Reader(
        FakeChatHandler handler, TimeSpan? timeLimit = null, ILogger<AzureReceiptReader>? logger = null) =>
        new(handler.Client(), logger ?? NullLogger<AzureReceiptReader>.Instance, timeLimit);

    // Remembers each message logged, with the exception logged with it.
    private sealed class RecordingLogger : ILogger<AzureReceiptReader>
    {
        public List<string> Entries { get; } = [];

        public void Log<TState>(
            LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
            Entries.Add($"{formatter(state, exception)} {exception}");

        public bool IsEnabled(LogLevel logLevel) => true;

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
    }

    // An answer that reads every field, with the given ones replaced.
    private static string Answer(JsonObject? changes = null)
    {
        var answer = new JsonObject
        {
            ["notAReceipt"] = false,
            ["purchaseDate"] = "2026-10-12",
            ["merchantName"] = "Kiwi",
            ["total"] = 249.90,
            ["currencyCode"] = "NOK",
            ["isRefund"] = false,
            ["category"] = "Groceries",
        };
        foreach (var (name, value) in changes ?? [])
            answer[name] = value?.DeepClone();
        return answer.ToJsonString();
    }

    private static JsonNode UserMessage(JsonNode request) =>
        request["messages"]!.AsArray().Single(m => (string?)m!["role"] == "user")!;

    [Fact]
    public async Task Read_ValidAnswer_IsReadWithItsFields()
    {
        var handler = FakeChatHandler.AnsweringWithContent("""
            {"notAReceipt": false, "purchaseDate": "2026-10-12", "merchantName": "Bakeriet Lille",
             "total": 89.5, "currencyCode": "NOK", "isRefund": true, "category": "Restaurants"}
            """);

        var reading = await Reader(handler).ReadAsync(Jpeg, Categories);

        Assert.Equal(
            new ReceiptReading.Read(new DateOnly(2026, 10, 12), "Bakeriet Lille", 89.5m, "NOK", true, "Restaurants"),
            reading);
    }

    [Fact]
    public async Task Read_AnswerWithNothingMadeOut_IsReadWithEveryFieldNull()
    {
        var handler = FakeChatHandler.AnsweringWithContent("""
            {"notAReceipt": false, "purchaseDate": null, "merchantName": null,
             "total": null, "currencyCode": null, "isRefund": false, "category": null}
            """);

        var reading = await Reader(handler).ReadAsync(Jpeg, Categories);

        Assert.Equal(new ReceiptReading.Read(null, null, null, null, false, null), reading);
    }

    [Theory]
    [InlineData("12.10.2026")]
    [InlineData("2026-13-01")]
    [InlineData("i går")]
    public async Task Read_AnswerWithADateThatIsNotAnIsoDate_IsReadWithoutAPurchaseDate(string purchaseDate)
    {
        var handler = FakeChatHandler.AnsweringWithContent(Answer(new() { ["purchaseDate"] = purchaseDate }));

        var reading = await Reader(handler).ReadAsync(Jpeg, Categories);

        Assert.Equal(new ReceiptReading.Read(null, "Kiwi", 249.90m, "NOK", false, "Groceries"), reading);
    }

    [Fact]
    public async Task Read_AnswerThatItIsNotAReceipt_IsUnreadable()
    {
        var handler = FakeChatHandler.AnsweringWithContent(Answer(new() { ["notAReceipt"] = true }));

        var reading = await Reader(handler).ReadAsync(Jpeg, Categories);

        Assert.IsType<ReceiptReading.Unreadable>(reading);
    }

    [Theory]
    [InlineData("I can't read this receipt.")]
    [InlineData("""{"notAReceipt": false, "purchaseDate": "2026-10-12", "merchantName": "Ki""")]
    [InlineData("{}")]
    [InlineData("null")]
    [InlineData("""{"notAReceipt": false, "purchaseDate": "2026-10-12", "merchantName": "Kiwi"}""")]
    [InlineData("""{"notAReceipt": null, "purchaseDate": null, "merchantName": null, "total": null, "currencyCode": null, "isRefund": false, "category": null}""")]
    [InlineData("""{"notAReceipt": false, "purchaseDate": null, "merchantName": null, "total": null, "currencyCode": null, "isRefund": null, "category": null}""")]
    [InlineData("""{"notAReceipt": false, "purchaseDate": null, "merchantName": null, "total": "249,90", "currencyCode": null, "isRefund": false, "category": null}""")]
    [InlineData("")]
    public async Task Read_MalformedOrPartialAnswer_IsUnreadable(string content)
    {
        var reading = await Reader(FakeChatHandler.AnsweringWithContent(content)).ReadAsync(Jpeg, Categories);

        Assert.IsType<ReceiptReading.Unreadable>(reading);
    }

    [Fact]
    public async Task Read_ResponseThatIsNotAChatCompletion_IsUnreadable()
    {
        var reading = await Reader(FakeChatHandler.Answering(HttpStatusCode.OK, "<html>Bad gateway</html>"))
            .ReadAsync(Jpeg, Categories);

        Assert.IsType<ReceiptReading.Unreadable>(reading);
    }

    [Theory]
    [InlineData(HttpStatusCode.BadRequest)]
    [InlineData(HttpStatusCode.TooManyRequests)]
    [InlineData(HttpStatusCode.InternalServerError)]
    [InlineData(HttpStatusCode.Unauthorized)]
    [InlineData(HttpStatusCode.Forbidden)]
    public async Task Read_ErrorStatus_IsUnreadable(HttpStatusCode status)
    {
        var handler = FakeChatHandler.Answering(status, """{"error": {"code": "error", "message": "Failed."}}""");

        var reading = await Reader(handler).ReadAsync(Jpeg, Categories);

        Assert.IsType<ReceiptReading.Unreadable>(reading);
    }

    [Fact]
    public async Task Read_NetworkError_IsUnreadable()
    {
        var handler = new FakeChatHandler(_ => throw new HttpRequestException("No route to host."));

        var reading = await Reader(handler).ReadAsync(Jpeg, Categories);

        Assert.IsType<ReceiptReading.Unreadable>(reading);
    }

    [Fact]
    public async Task Read_NoResponseWithinTheTimeLimit_IsUnreadable()
    {
        var handler = new FakeChatHandler(async cancellationToken =>
        {
            await Task.Delay(Timeout.Infinite, cancellationToken);
            throw new UnreachableException();
        });

        var reading = await Reader(handler, TimeSpan.FromMilliseconds(200)).ReadAsync(Jpeg, Categories);

        Assert.IsType<ReceiptReading.Unreadable>(reading);
    }

    public static TheoryData<string> AnswersThatAreUnreadable => new()
    {
        Answer(new() { ["notAReceipt"] = true, ["merchantName"] = "Kiwi Torgallmenningen" }),
        "Kiwi Torgallmenningen 249,90",
        """{"notAReceipt": false, "purchaseDate": "2026-10-12", "merchantName": "Kiwi Torgallmenningen", "total": "249,90"}""",
    };

    [Theory]
    [MemberData(nameof(AnswersThatAreUnreadable))]
    public async Task Read_UnreadableAnswer_LogsTheImagesSizeAndMediaTypeButNothingReadFromIt(string content)
    {
        var logger = new RecordingLogger();

        await Reader(FakeChatHandler.AnsweringWithContent(content), logger: logger).ReadAsync(Jpeg, Categories);

        var entry = Assert.Single(logger.Entries);
        Assert.Contains("image/jpeg", entry);
        Assert.Contains($"{Jpeg.Image.Length} bytes", entry);
        Assert.DoesNotContain("Kiwi", entry);
        Assert.DoesNotContain("Torgallmenningen", entry);
        Assert.DoesNotContain("249", entry);
        Assert.DoesNotContain("2026", entry);
    }

    [Fact]
    public async Task Read_ErrorStatus_LogsTheFailureWithTheImagesSizeAndMediaType()
    {
        var logger = new RecordingLogger();
        var handler = FakeChatHandler.Answering(
            HttpStatusCode.TooManyRequests, """{"error": {"code": "429", "message": "Rate limit reached."}}""");

        await Reader(handler, logger: logger).ReadAsync(Jpeg, Categories);

        var entry = Assert.Single(logger.Entries);
        Assert.Contains("image/jpeg", entry);
        Assert.Contains($"{Jpeg.Image.Length} bytes", entry);
        Assert.Contains("429", entry);
        Assert.DoesNotContain(Convert.ToBase64String(Jpeg.Image), entry);
    }

    [Fact]
    public async Task Read_SendsTheReceiptAsAnImageOfItsMediaType()
    {
        var handler = FakeChatHandler.AnsweringWithContent(Answer());

        await Reader(handler).ReadAsync(Jpeg, Categories);

        var request = JsonNode.Parse(Assert.Single(handler.RequestBodies))!;
        Assert.Equal("gpt-4.1-mini", (string?)request["model"]);
        var image = UserMessage(request)["content"]!.AsArray().Single(p => (string?)p!["type"] == "image_url")!;
        Assert.Equal(
            "data:image/jpeg;base64," + Convert.ToBase64String(Jpeg.Image),
            (string?)image["image_url"]!["url"]);
    }

    [Fact]
    public async Task Read_SendsEveryCategoryWithItsNameAndDescription()
    {
        var handler = FakeChatHandler.AnsweringWithContent(Answer());

        await Reader(handler).ReadAsync(Jpeg, Categories);

        var request = JsonNode.Parse(Assert.Single(handler.RequestBodies))!;
        var text = UserMessage(request)["content"]!.AsArray().Single(p => (string?)p!["type"] == "text")!;
        var expected = JsonNode.Parse("""
            {
              "categories": [
                {"name": "Groceries", "description": "All groceries."},
                {"name": "Other", "description": "Everything that fits no other category."},
                {"name": "Restaurants", "description": "Restaurant, takeaway, bakery etc."}
              ]
            }
            """);
        Assert.True(
            JsonNode.DeepEquals(expected, JsonNode.Parse((string)text["text"]!)),
            $"Unexpected user message text: {text["text"]}");
    }

    [Fact]
    public async Task Read_AsksForTheStrictSchemaWithEveryFieldNullableAndTheCategoryOneOfTheGivenNames()
    {
        var handler = FakeChatHandler.AnsweringWithContent(Answer());

        await Reader(handler).ReadAsync(Jpeg, Categories);

        var request = JsonNode.Parse(Assert.Single(handler.RequestBodies))!;
        var format = request["response_format"]!;
        Assert.Equal("json_schema", (string?)format["type"]);
        Assert.True((bool?)format["json_schema"]!["strict"]);
        var schema = format["json_schema"]!["schema"]!;
        var expected = JsonNode.Parse("""
            {
              "type": "object",
              "properties": {
                "notAReceipt": {"type": "boolean"},
                "purchaseDate": {"type": ["string", "null"]},
                "merchantName": {"type": ["string", "null"]},
                "total": {"type": ["number", "null"]},
                "currencyCode": {"type": ["string", "null"]},
                "isRefund": {"type": "boolean"},
                "category": {"type": ["string", "null"], "enum": ["Groceries", "Other", "Restaurants", null]}
              },
              "required": ["notAReceipt", "purchaseDate", "merchantName", "total", "currencyCode", "isRefund", "category"],
              "additionalProperties": false
            }
            """)!;
        // Descriptions guide the model but aren't part of what the schema allows.
        foreach (var (_, property) in schema["properties"]!.AsObject())
            property!.AsObject().Remove("description");
        Assert.True(JsonNode.DeepEquals(expected, schema), $"Unexpected schema: {schema}");
    }

    [Fact]
    public void AddRuleGenerator_WithoutAnEndpoint_RegistersNoReceiptReader()
    {
        var services = Services(new() { ["RuleGenerator:Deployment"] = "gpt-4.1-mini" });

        Assert.Null(services.GetService<IReceiptReader>());
    }

    [Fact]
    public void AddRuleGenerator_WithAnEndpointAndDeployment_RegistersTheAzureReceiptReaderAlongsideTheRuleGenerator()
    {
        var services = Services(new()
        {
            ["RuleGenerator:Endpoint"] = "https://example.invalid/",
            ["RuleGenerator:Deployment"] = "gpt-4.1-mini",
        });

        Assert.IsType<AzureReceiptReader>(services.GetService<IReceiptReader>());
        Assert.IsType<AzureRuleGenerator>(services.GetService<IRuleGenerator>());
    }

    private static ServiceProvider Services(Dictionary<string, string?> settings) =>
        new ServiceCollection()
            .AddLogging()
            .AddRuleGenerator(new ConfigurationBuilder().AddInMemoryCollection(settings).Build())
            .BuildServiceProvider();
}
