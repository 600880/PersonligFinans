using System.Text.Encodings.Web;
using System.Text.Json;
using OpenAI.Chat;

namespace PersonligFinans.Api.CategorizationRules;

// The rule generator backed by a chat model deployed on Azure: one call per import, answered with
// JSON that must follow a schema. Only each row's description and sign, and the Category names,
// are sent; never existing rules, Amounts, dates or account numbers.
public class AzureRuleGenerator(ChatClient chat, ILogger<AzureRuleGenerator> logger, TimeSpan? timeLimit = null)
    : IRuleGenerator
{
    // Long enough for a statement's worth of rows, short enough that an upload never hangs on it.
    private static readonly TimeSpan DefaultTimeLimit = TimeSpan.FromSeconds(20);

    private const string Instructions = """
        You create categorization rules for a personal finance app's bank transactions. You get the
        list of category names, and the rows to categorize. Each row has an index, the description
        from the bank statement, and a sign: "negative" means money was spent, "positive" means money
        was received.

        For each row, answer with its index and either:
        - a category and a keyword: the category must be one of the given category names. The keyword
          is a short merchant name, in lowercase, copied literally from the description so that it
          matches this merchant's future transactions at any of its locations. Leave out city, area
          and place names, store numbers, dates, card numbers and payment prefixes. For example,
          "Kiwi 512 Bergen Sentrum" gives "kiwi", and "Peppes Pizza Lille Torget" gives "peppes pizza".
        - or a decline, with keyword and category both null: when the row has no recognizable
          merchant, such as a payment to or from a private person, or when you are unsure of the
          category. Never use a catch-all category for a row you can't place; decline it instead.
        """;

    private static readonly JsonSerializerOptions PromptJson = new(JsonSerializerDefaults.Web)
    {
        // Keeps Norwegian letters readable for the model rather than escaped.
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    // Missing or null required values make the answer malformed rather than defaulting silently.
    private static readonly JsonSerializerOptions AnswerJson = new(JsonSerializerDefaults.Web)
    {
        RespectNullableAnnotations = true,
        RespectRequiredConstructorParameters = true,
    };

    private record PromptRow(int Index, string Description, string Sign);

    private record Prompt(IReadOnlyList<string> Categories, IReadOnlyList<PromptRow> Rows);

    private record AnswerRow(int Index, string? Keyword, string? Category);

    private record Answer(IReadOnlyList<AnswerRow> Rows);

    public async Task<RuleGeneration> GenerateAsync(IReadOnlyList<UnmatchedRow> rows, IReadOnlyList<string> categoryNames)
    {
        try
        {
            var prompt = new Prompt(
                categoryNames,
                rows.Select((row, index) => new PromptRow(
                    index, row.Description, row.Sign == AmountSign.Negative ? "negative" : "positive")).ToList());
            var options = new ChatCompletionOptions
            {
                ResponseFormat = ChatResponseFormat.CreateJsonSchemaFormat(
                    "categorization_rules", AnswerSchema(categoryNames), jsonSchemaIsStrict: true),
            };

            using var timeout = new CancellationTokenSource(timeLimit ?? DefaultTimeLimit);
            ChatCompletion completion = await chat.CompleteChatAsync(
                [new SystemChatMessage(Instructions), new UserChatMessage(JsonSerializer.Serialize(prompt, PromptJson))],
                options,
                timeout.Token);

            var answer = JsonSerializer.Deserialize<Answer>(completion.Content[0].Text, AnswerJson)
                ?? throw new JsonException("The answer is null.");
            return new RuleGeneration.Generated(Proposals(answer, rows));
        }
        catch (Exception e)
        {
            // Logged without the rows: the exception describes the failure, not the transaction data.
            logger.LogWarning(e, "The rule generator was unavailable for {RowCount} rows.", rows.Count);
            return new RuleGeneration.Unavailable();
        }
    }

    // A proposal for each row the answer gives both a keyword and a Category, matched to the row by
    // the index it was sent with. Entries for unknown indexes are ignored, and the first entry for a
    // row wins. The import checks each proposal before it becomes a rule.
    private static Dictionary<UnmatchedRow, RuleProposal> Proposals(Answer answer, IReadOnlyList<UnmatchedRow> rows)
    {
        var proposals = new Dictionary<UnmatchedRow, RuleProposal>();
        foreach (var entry in answer.Rows)
        {
            if (entry.Index < 0 || entry.Index >= rows.Count ||
                string.IsNullOrWhiteSpace(entry.Keyword) || string.IsNullOrWhiteSpace(entry.Category))
                continue;
            proposals.TryAdd(rows[entry.Index], new RuleProposal(entry.Keyword, entry.Category));
        }
        return proposals;
    }

    // The schema the answer must follow. Strict mode needs every property required and no others;
    // a decline is a null keyword and Category.
    private static BinaryData AnswerSchema(IReadOnlyList<string> categoryNames) =>
        BinaryData.FromObjectAsJson(new
        {
            type = "object",
            properties = new
            {
                rows = new
                {
                    type = "array",
                    items = new
                    {
                        type = "object",
                        properties = new
                        {
                            index = new { type = "integer" },
                            keyword = new { type = new[] { "string", "null" } },
                            category = new
                            {
                                type = new[] { "string", "null" },
                                @enum = categoryNames.Cast<string?>().Append(null).ToArray(),
                            },
                        },
                        required = new[] { "index", "keyword", "category" },
                        additionalProperties = false,
                    },
                },
            },
            required = new[] { "rows" },
            additionalProperties = false,
        });
}
