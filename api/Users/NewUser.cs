using Microsoft.AspNetCore.Identity;
using PersonligFinans.Api.Data;

namespace PersonligFinans.Api.Users;

// How every User is created, whether by registering or, for the Guest, by the app at start-up: so
// that each starts with the seeds.
public static class NewUser
{
    // Creates the User, with the password if they have one, and copies of the seeds of their own.
    // Identity's store saves through the same context, so the User and their seeds are created
    // together or not at all. Nothing is created when Identity refuses the User.
    public static async Task<IdentityResult> CreateAsync(
        UserManager<IdentityUser> userManager, AppDbContext db, IdentityUser user, string? password = null)
    {
        await using var transaction = await db.Database.BeginTransactionAsync();
        var result = password is null
            ? await userManager.CreateAsync(user)
            : await userManager.CreateAsync(user, password);
        if (!result.Succeeded)
            return result;

        Seeds.AddTo(db, user.Id);
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
        return result;
    }
}
