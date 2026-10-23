namespace PersonligFinans.Api.Data;

// One AI request made on a User's behalf, kept to count against the Daily AI limit.
public class AiRequest
{
    public long Id { get; set; }

    // Null once its User is deleted, when it still counts towards the cap on all Users together.
    public string? UserId { get; set; }

    public DateTimeOffset MadeAt { get; set; }
}
