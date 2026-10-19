namespace PersonligFinans.Api.Data;

// One reset email the app tried to send to a User, whether or not sending it succeeded, kept to
// count against the caps on reset emails.
public class SentPasswordResetEmail
{
    public long Id { get; set; }

    public required string UserId { get; set; }

    public DateTimeOffset SentAt { get; set; }
}
