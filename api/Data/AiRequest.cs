namespace PersonligFinans.Api.Data;

// One AI request made on a User's behalf, kept to count against the Daily AI limit.
public class AiRequest
{
    public long Id { get; set; }

    public required string UserId { get; set; }

    public DateTimeOffset MadeAt { get; set; }
}
