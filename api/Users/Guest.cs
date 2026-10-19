using Microsoft.AspNetCore.Identity;
using PersonligFinans.Api.Data;

namespace PersonligFinans.Api.Users;

// The one User anyone can sign in as without signing up, by continuing as the Guest. It is an
// ordinary User whose email is on a reserved domain nobody can sign up with, and which has no
// password, so Sign in can never reach it. See docs/adr/0005-guest-is-one-shared-user.md.
public static class Guest
{
    // .invalid is reserved for names that can never exist, so no real email is on this domain.
    private const string ReservedDomain = "personligfinans.invalid";

    public const string Email = "guest@" + ReservedDomain;

    // Whether the email is the Guest's, ignoring case, as Identity matches emails.
    public static bool Is(string email) => string.Equals(email, Email, StringComparison.OrdinalIgnoreCase);

    // Whether the email is on the Guest's reserved domain, where nobody can sign up or sign in.
    public static bool IsReserved(string email) =>
        email.EndsWith("@" + ReservedDomain, StringComparison.OrdinalIgnoreCase);

    // Creates the Guest, starting like any new User, unless it already exists. An existing Guest is
    // never reset, so it keeps whatever visitors have added. Sign in never tries the Guest, and as
    // well the Guest is exempt from the lockout Identity gives every new User, so nothing can lock
    // it out.
    public static async Task CreateIfMissingAsync(IServiceProvider services)
    {
        using var scope = services.CreateScope();
        var userManager = scope.ServiceProvider.GetRequiredService<UserManager<IdentityUser>>();
        var guest = await userManager.FindByNameAsync(Email);
        if (guest is null)
        {
            guest = new IdentityUser { UserName = Email, Email = Email };
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            ThrowIfFailed(await NewUser.CreateAsync(userManager, db, guest));
        }
        if (guest.LockoutEnabled)
            ThrowIfFailed(await userManager.SetLockoutEnabledAsync(guest, false));
    }

    private static void ThrowIfFailed(IdentityResult result)
    {
        if (!result.Succeeded)
            throw new InvalidOperationException(
                "Creating the Guest failed: " + string.Join(" ", result.Errors.Select(e => e.Description)));
    }
}
