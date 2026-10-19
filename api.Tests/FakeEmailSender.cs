using PersonligFinans.Api.Emails;

namespace PersonligFinans.Api.Tests;

// Stands in for Azure Communication Services: remembers every email it is asked to send, and fails
// to send each one when told to.
public class FakeEmailSender : IEmailSender
{
    public bool Failing { get; init; }

    public List<OutgoingEmail> Sent { get; } = [];

    public Task SendAsync(OutgoingEmail email)
    {
        lock (Sent)
            Sent.Add(email);
        if (Failing)
            throw new InvalidOperationException("The fake email sender was told to fail.");
        return Task.CompletedTask;
    }
}
