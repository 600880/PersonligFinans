namespace PersonligFinans.Api.Emails;

// One email to one address, in plain text and in HTML, for mail clients that show either.
public record OutgoingEmail(string To, string Subject, string PlainText, string Html);

// Sends email from the app. Optional: without one configured, nothing that needs email is
// available. Throws when the email couldn't be handed over for delivery.
public interface IEmailSender
{
    Task SendAsync(OutgoingEmail email);
}
