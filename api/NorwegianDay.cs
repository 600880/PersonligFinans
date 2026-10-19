namespace PersonligFinans.Api;

// The days the app counts by, which start at midnight Norwegian time wherever the server runs: the
// Daily AI limit's, and the daily cap on reset emails.
public static class NorwegianDay
{
    private static readonly TimeZoneInfo Norway = TimeZoneInfo.FindSystemTimeZoneById("Europe/Oslo");

    // The day in Norway that the instant falls on, from the midnight that starts it to the one that
    // ends it. Bounded at both ends, so counting rows within it counts only that day's, whatever else
    // is stored.
    public static (DateTimeOffset Start, DateTimeOffset End) Around(DateTimeOffset instant)
    {
        var date = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(instant, Norway).DateTime);
        return (Midnight(date), Midnight(date.AddDays(1)));
    }

    // The instant the date starts in Norway, in UTC as Postgres stores it. Its UTC offset, an hour in
    // winter and two in summer, is the one in force at that midnight. Norway changes its clocks at
    // 02:00 or 03:00, never at midnight, so midnight always exists and happens once.
    private static DateTimeOffset Midnight(DateOnly date)
    {
        var midnight = date.ToDateTime(TimeOnly.MinValue);
        return new DateTimeOffset(midnight, Norway.GetUtcOffset(midnight)).ToUniversalTime();
    }
}
