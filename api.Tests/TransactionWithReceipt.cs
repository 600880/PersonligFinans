using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using PersonligFinans.Api.Transactions;

namespace PersonligFinans.Api.Tests;

// Creating a manually-entered Transaction together with its Receipt, as the Receipt scan's Save does
// with "Keep the receipt" ticked: a multipart form with the JSON create's request in its transaction
// field and the Receipt's image in its receipt field.
public static class TransactionWithReceipt
{
    public const string Url = "/api/transactions/with-receipt";

    // The leading bytes of a JPEG, followed by a little filler. The endpoint only looks at how a file
    // starts, so this stands in for a reduced photo of a Receipt.
    public static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, .."JFIF"u8, 0x00, 0x2A];

    // Sends the create with the request as JSON and the Receipt, a JPEG unless another image is given.
    public static Task<HttpResponseMessage> PostAsync(HttpClient client, object transaction, byte[]? receipt = null) =>
        client.PostAsync(Url, Form(JsonSerializer.Serialize(transaction), receipt ?? Jpeg));

    // Creates the Transaction with its Receipt, which must succeed, and returns it as the API answered.
    public static async Task<TransactionResponse> CreateAsync(HttpClient client, object transaction, byte[]? receipt = null)
    {
        var response = await PostAsync(client, transaction, receipt);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<TransactionResponse>())!;
    }

    // The form as it is sent, with the transaction field as the text given and the receipt declared as
    // the content type given. A field given as null is left out.
    public static MultipartFormDataContent Form(string? transaction, byte[]? receipt, string contentType = "image/jpeg")
    {
        var form = new MultipartFormDataContent();
        if (transaction is not null)
            form.Add(new StringContent(transaction), "transaction");
        if (receipt is not null)
        {
            var file = new ByteArrayContent(receipt);
            file.Headers.ContentType = new MediaTypeHeaderValue(contentType);
            form.Add(file, "receipt", "blob");
        }
        return form;
    }
}
