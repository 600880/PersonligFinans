namespace PersonligFinans.Api.AiRequests;

// How many AI requests may be made a day, counted from midnight Norwegian time: by each User, and by
// all Users together. Set in the DailyAiLimit configuration section.
public sealed class DailyAiLimit
{
    public const string SectionName = "DailyAiLimit";

    public int PerUser { get; set; } = 30;

    public int AllUsers { get; set; } = 300;
}
