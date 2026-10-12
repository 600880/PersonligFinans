using System.Text.Encodings.Web;
using System.Text.Json;
using OpenAI.Chat;

namespace PersonligFinans.Api.CategorizationRules;

// The rule generator backed by a chat model deployed on Azure: one call per import, answered with
// JSON that must follow a schema. Only each row's description and sign, and each Category's name and
// description, are sent; never existing rules, Amounts, dates or account numbers. Every row is
// answered with a keyword and one of the given Categories; the model can't decline.
public class AzureRuleGenerator(ChatClient chat, ILogger<AzureRuleGenerator> logger, TimeSpan? timeLimit = null)
    : IRuleGenerator
{
    // A month's statement of unmatched rows can take 10–20 s to answer, plus a slow first token
    // locally; still short enough that an upload never hangs on it.
    private static readonly TimeSpan DefaultTimeLimit = TimeSpan.FromSeconds(60);

    private const string Instructions = """
        You create categorization rules for a personal finance app's bank transactions. The bank is
        norwegian so use what you know about norwegian merchants and services. You get the list of
        categories, each with a name and a description of what belongs in it, and the rows to
        categorize. Each row has an index, the description from the bank statement, and a sign:
        "negative" means money was spent, "positive" means money was received.

        For each row, answer with its index, a category and a keyword. The category must be the
        name of one of the given categories, chosen by what the categories' descriptions say belongs
        in them; use "Other" when no other category fits. The keyword is a short merchant or payee
        name, in lowercase, copied literally from the description so that it matches this merchant's
        future transactions at any of its locations. Leave out city, area and place names, store
        numbers, dates, card numbers and payment prefixes. For example, "Kiwi 512 Bergen Sentrum"
        gives "kiwi", and "Peppes Pizza Lille Torget" gives "peppes pizza". When the description
        names no merchant, use its most distinctive words.
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

    private record Prompt(IReadOnlyList<CategoryChoice> Categories, IReadOnlyList<PromptRow> Rows);

    private record AnswerRow(int Index, string Keyword, string Category);

    private record Answer(IReadOnlyList<AnswerRow> Rows);

    public async Task<RuleGeneration> GenerateAsync(IReadOnlyList<UnmatchedRow> rows, IReadOnlyList<CategoryChoice> categories)
    {
        try
        {
            var prompt = new Prompt(
                categories,
                rows.Select((row, index) => new PromptRow(
                    index, row.Description, row.Sign == AmountSign.Negative ? "negative" : "positive")).ToList());
            var options = new ChatCompletionOptions
            {
                ResponseFormat = ChatResponseFormat.CreateJsonSchemaFormat(
                    "categorization_rules", AnswerSchema(categories.Select(c => c.Name)), jsonSchemaIsStrict: true),
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

    // A proposal for each row the answer gives a keyword that isn't blank, matched to the row by the
    // index it was sent with. Entries for unknown indexes are ignored, and the first entry for a row
    // wins. The import checks each proposal before it becomes a rule.
    private static Dictionary<UnmatchedRow, RuleProposal> Proposals(Answer answer, IReadOnlyList<UnmatchedRow> rows)
    {
        var proposals = new Dictionary<UnmatchedRow, RuleProposal>();
        foreach (var entry in answer.Rows)
        {
            if (entry.Index < 0 || entry.Index >= rows.Count ||
                string.IsNullOrWhiteSpace(entry.Keyword))
                continue;
            proposals.TryAdd(rows[entry.Index], new RuleProposal(entry.Keyword, entry.Category));
        }
        return proposals;
    }

    // The schema the answer must follow. Strict mode needs every property required and no others;
    // there is no way to decline. The Category is given by name alone.
    private static BinaryData AnswerSchema(IEnumerable<string> categoryNames) =>
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
                            keyword = new { type = "string" },
                            category = new { type = "string", @enum = categoryNames.ToArray() },
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
