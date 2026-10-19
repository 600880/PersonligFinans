namespace PersonligFinans.Api.Users;

// How many reset emails the app sends: no more than one to a User every PerAddressMinutes, so
// nobody can flood a User's inbox, and no more than PerDay from the whole app in a day, counted from
// midnight Norwegian time, so abuse can't run up the bill for sending email. Set in the
// PasswordResetLimit configuration section.
public sealed class PasswordResetLimit
{
    public const string SectionName = "PasswordResetLimit";

    public int PerAddressMinutes { get; set; } = 5;

    public int PerDay { get; set; } = 50;
}
