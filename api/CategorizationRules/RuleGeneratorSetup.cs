using System.ClientModel.Primitives;
using Azure.Identity;
using OpenAI;
using OpenAI.Chat;
using PersonligFinans.Api.Receipts;

namespace PersonligFinans.Api.CategorizationRules;

public static class RuleGeneratorSetup
{
    public const string SectionName = "RuleGenerator";

    // The token audience of Azure AI Services, for Microsoft Entra ID authentication.
    private const string TokenScope = "https://cognitiveservices.azure.com/.default";

    // Registers the Azure rule generator and the Azure receipt reader, sharing one chat client, when
    // RuleGenerator:Endpoint is configured, e.g. https://<resource>.openai.azure.com/. The deployment
    // must accept image input for the receipt reader. Without an endpoint neither is registered, so
    // the import leaves unmatched rows Uncategorized and every Receipt is answered Unavailable, as in
    // local development and tests. It authenticates with DefaultAzureCredential: the App Service's
    // managed identity in production, `az login` locally.
    public static IServiceCollection AddRuleGenerator(this IServiceCollection services, IConfiguration configuration)
    {
        var section = configuration.GetSection(SectionName);
        var endpoint = section["Endpoint"];
        if (string.IsNullOrWhiteSpace(endpoint))
            return services;

        var deployment = section["Deployment"];
        if (string.IsNullOrWhiteSpace(deployment))
            throw new InvalidOperationException(
                $"'{SectionName}:Endpoint' is set, but '{SectionName}:Deployment' is not. " +
                "Set it to the name of a chat model deployment on that resource that accepts images, e.g. gpt-4.1-mini.");

        // Azure's v1 API is OpenAI-compatible, so the OpenAI client calls it, with an Entra ID token
        // instead of an API key. The OpenAI library still marks this constructor as experimental.
#pragma warning disable OPENAI001
        var chat = new ChatClient(
            deployment,
            new BearerTokenPolicy(new DefaultAzureCredential(), TokenScope),
            new OpenAIClientOptions { Endpoint = new Uri(new Uri(endpoint), "openai/v1/") });
#pragma warning restore OPENAI001
        return services
            .AddSingleton<IRuleGenerator>(provider =>
                new AzureRuleGenerator(chat, provider.GetRequiredService<ILogger<AzureRuleGenerator>>()))
            .AddSingleton<IReceiptReader>(provider =>
                new AzureReceiptReader(chat, provider.GetRequiredService<ILogger<AzureReceiptReader>>()));
    }
}
