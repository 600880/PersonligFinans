using Azure;
using Azure.Communication.Email;

namespace PersonligFinans.Api.Emails;

// Sends email through Azure Communication Services, from the sender address of its Azure-managed
// domain.
public class AcsEmailSender(EmailClient client, string sender) : IEmailSender
{
    // Waits only until Communication Services has accepted the email, not until it is delivered,
    // which can take minutes. A failed delivery after that is in the resource's logs, not here.
    public async Task SendAsync(OutgoingEmail email)
    {
        var content = new EmailContent(email.Subject) { PlainText = email.PlainText, Html = email.Html };
        await client.SendAsync(WaitUntil.Started, new EmailMessage(sender, email.To, content));
    }
}
