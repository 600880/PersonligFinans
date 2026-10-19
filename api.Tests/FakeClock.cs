namespace PersonligFinans.Api.Tests;

// Stands in for the system clock: reads whatever time the test last set.
public class FakeClock(DateTimeOffset now) : TimeProvider
{
    public DateTimeOffset Now { get; set; } = now;

    public override DateTimeOffset GetUtcNow() => Now.ToUniversalTime();
}
