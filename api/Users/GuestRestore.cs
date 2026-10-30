namespace PersonligFinans.Api.Users;

// How often continuing as the Guest may Restore it: at most once every CooldownMinutes. Set in the
// GuestRestore configuration section.
public sealed class GuestRestore
{
    public const string SectionName = "GuestRestore";

    public int CooldownMinutes { get; set; } = 20;
}
