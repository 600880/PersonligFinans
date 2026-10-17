using System.ClientModel;
using System.ClientModel.Primitives;
using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using OpenAI;
using OpenAI.Chat;

namespace PersonligFinans.Api.Tests;

// A faked HTTP layer under the chat client of the Azure adapters, so their tests never call Azure.
// Answers every request with the given response, and remembers the request bodies.
public sealed class FakeChatHandler(Func<CancellationToken, Task<HttpResponseMessage>> respond) : HttpMessageHandler
{
    public List<string> RequestBodies { get; } = [];

    public static FakeChatHandler Answering(HttpStatusCode status, string body) =>
        new(_ => Task.FromResult(new HttpResponseMessage(status)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        }));

    // A chat completion whose message is the given content, as the model wrote it.
    public static FakeChatHandler AnsweringWithContent(string content) =>
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

    // A chat client for the gpt-4.1-mini deployment that sends through this handler, without retries.
    public ChatClient Client()
    {
        var options = new OpenAIClientOptions
        {
            Endpoint = new Uri("https://example.invalid/openai/v1/"),
            Transport = new HttpClientPipelineTransport(new HttpClient(this)),
            RetryPolicy = new ClientRetryPolicy(maxRetries: 0),
        };
        return new ChatClient("gpt-4.1-mini", new ApiKeyCredential("test"), options);
    }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        RequestBodies.Add(await request.Content!.ReadAsStringAsync(cancellationToken));
        return await respond(cancellationToken);
    }
}
