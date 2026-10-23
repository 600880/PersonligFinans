using System.Security.Claims;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using PersonligFinans.Api.CategorizationRules;
using PersonligFinans.Api.Data;

namespace PersonligFinans.Api.Users;

public record CredentialsRequest(string? Email, string? Password);

public record ChangePasswordRequest(string? CurrentPassword, string? NewPassword);

public record DeleteYourUserRequest(string? Password);

// What the User page's confirm dialogs count, so each asks with the exact number it deletes. The Bank
// Statements' counts come from their list instead. RuleCategorizedTransactionCount: the Transactions
// that deleting every rule makes Uncategorized.
public record DeleteCountsResponse(int TransactionCount, int RuleCount, int RuleCategorizedTransactionCount);

// The signed-in User, by their email, and whether they are the Guest.
public record UserResponse(string Email, bool IsGuest)
{
    public static UserResponse Of(string email) => new(email, Guest.Is(email));
}

public static class UserEndpoints
{
    // Identity's limit on a user name and an email.
    private const int MaxEmailLength = 256;

    private const string EmailTaken = "This email is already in use.";


    public static void MapUserEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api/user");

        // Who is signed in. Signed out, the fallback policy answers 401 before this runs, which is
        // how the client knows to show its landing page.
        api.MapGet("/", (ClaimsPrincipal user) => Results.Ok(UserResponse.Of(user.Identity!.Name!)));

        // Signing up, signing in, continuing as the Guest and signing out are for anyone; signing
        // out when signed out does nothing.
        api.MapPost("/sign-up", SignUp).AllowAnonymous();
        api.MapPost("/sign-in", SignIn).AllowAnonymous();
        api.MapPost("/continue-as-guest", ContinueAsGuest).AllowAnonymous();
        api.MapPost("/sign-out", SignOut).AllowAnonymous();

        // Like Sign in it takes only JSON, which another site's form can't send.
        api.MapPost("/change-password", ChangePassword);

        api.MapGet("/delete-counts", DeleteCounts);

        // Takes only JSON too, like Change password.
        api.MapPost("/delete", DeleteYourUser);
    }

    // Creates a User whose user name is their email, with copies of the seeds of their own, and signs
    // it in.
    private static async Task<IResult> SignUp(
        CredentialsRequest request,
        UserManager<IdentityUser> userManager,
        SignInManager<IdentityUser> signInManager,
        AppDbContext db)
    {
        var (email, password, errors) = ValidateRequired(request);
        if (errors.Count > 0)
            return Results.ValidationProblem(errors);
        if (email.Length > MaxEmailLength)
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["email"] = [$"Email must be at most {MaxEmailLength} characters."],
            });

        var user = new IdentityUser { UserName = email, Email = email };

        // Creating the User stops at the first validator that fails, so the email and the password
        // are validated here first, to report every field that is wrong at once.
        var identityErrors = new List<IdentityError>();
        foreach (var validator in userManager.UserValidators)
            identityErrors.AddRange((await validator.ValidateAsync(userManager, user)).Errors);
        identityErrors.AddRange(await PasswordRuleErrors(userManager, user, password));
        var fieldErrors = FieldErrors(identityErrors);
        // The Guest's email, which is taken, and any other on its domain, which is kept for the
        // Guest.
        if (Guest.IsReserved(email))
            fieldErrors["email"] = ["This email can't be used."];
        if (fieldErrors.Count > 0)
            return Results.ValidationProblem(fieldErrors);

        IdentityResult result;
        try
        {
            result = await NewUser.CreateAsync(userManager, db, user, password);
        }
        // Someone signed up with the email concurrently, between validation and now.
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["email"] = [EmailTaken] });
        }
        if (!result.Succeeded)
            return Results.ValidationProblem(FieldErrors(result.Errors));

        await signInManager.SignInAsync(user, isPersistent: true);
        return Results.Ok(UserResponse.Of(email));
    }

    // Signs in with an email and password. A wrong email and a wrong password get the same answer, so
    // nobody can find out which emails are in use. Every failure counts towards locking the
    // email, and a locked email is refused, even with the right password, until the lockout ends.
    // The Guest has no password and is never tried, so its failures never count and it is never
    // locked.
    private static async Task<IResult> SignIn(
        CredentialsRequest request, UserManager<IdentityUser> userManager, SignInManager<IdentityUser> signInManager)
    {
        var (email, password, errors) = ValidateRequired(request);
        if (errors.Count > 0)
            return Results.ValidationProblem(errors);
        if (Guest.IsReserved(email))
            return WrongEmailOrPassword();

        var result = await signInManager.PasswordSignInAsync(email, password, isPersistent: true, lockoutOnFailure: true);
        if (result.IsLockedOut)
            return EmailLocked();
        if (!result.Succeeded)
            return WrongEmailOrPassword();

        // The email as it was signed up with, whatever its case when signing in.
        var user = await userManager.FindByNameAsync(email);
        return Results.Ok(UserResponse.Of(user!.Email!));
    }

    // Signs in as the Guest, which the app created at start-up, for as long as any other sign-in.
    // Like signing in and signing up, it takes only JSON, which another site's form can't send, so
    // no other site can sign its visitors in as the Guest.
    private static async Task<IResult> ContinueAsGuest(
        HttpRequest request, UserManager<IdentityUser> userManager, SignInManager<IdentityUser> signInManager)
    {
        if (!request.HasJsonContentType())
            return Results.StatusCode(StatusCodes.Status415UnsupportedMediaType);

        var guest = await userManager.FindByNameAsync(Guest.Email)
            ?? throw new InvalidOperationException("The Guest doesn't exist; the app creates it at start-up.");
        await signInManager.SignInAsync(guest, isPersistent: true);
        return Results.Ok(UserResponse.Of(guest.Email!));
    }

    // Change password: sets a new password for the signed-in User, given the current one, so that
    // someone using an open tab can't take the User over. A wrong current password counts towards the
    // same lockout as a failed sign-in, and a locked email is refused with Sign in's message, even
    // with the right password. The new password follows Sign up's rules, and every field that is wrong
    // is reported at once. The Guest has no password, so nobody can give the shared Guest one.
    private static async Task<IResult> ChangePassword(
        ChangePasswordRequest request,
        ClaimsPrincipal principal,
        UserManager<IdentityUser> userManager,
        SignInManager<IdentityUser> signInManager)
    {
        if (Guest.Is(principal.Identity!.Name!))
            return Results.Problem(detail: "The Guest has no password.", statusCode: StatusCodes.Status403Forbidden);

        var currentPassword = request.CurrentPassword ?? "";
        var newPassword = request.NewPassword ?? "";
        var errors = new Dictionary<string, string[]>();
        if (currentPassword.Length == 0)
            errors["currentPassword"] = ["Current password is required."];
        if (newPassword.Length == 0)
            errors["newPassword"] = ["New password is required."];
        if (errors.Count > 0)
            return Results.ValidationProblem(errors);

        // Only a signed-in User gets here, and the security stamp check has just found it.
        var user = (await userManager.GetUserAsync(principal))!;

        // As at Sign in, a locked email is refused before its password is tried, and the failure that
        // locks it gets the lockout's answer.
        var check = await signInManager.CheckPasswordSignInAsync(user, currentPassword, lockoutOnFailure: true);
        if (check.IsLockedOut)
            return EmailLocked();
        if (!check.Succeeded)
            errors["currentPassword"] = ["Wrong password."];

        if (FieldErrors(await PasswordRuleErrors(userManager, user, newPassword)).TryGetValue("password", out var newPasswordErrors))
            errors["newPassword"] = newPasswordErrors;
        if (errors.Count > 0)
            return Results.ValidationProblem(errors);

        // Both passwords were just checked, so this fails only if the User changes its password in
        // another request at the same moment.
        var result = await userManager.ChangePasswordAsync(user, currentPassword, newPassword);
        if (!result.Succeeded)
            throw new InvalidOperationException(
                "Changing the password failed: " + string.Join(" ", result.Errors.Select(e => e.Description)));

        // Changing the password changed the User's security stamp, so every other browser's sign-in
        // as the User ends at its next request (see UserSetup), while this one gets a fresh cookie with
        // the new stamp, as persistent as the one it replaces.
        await signInManager.RefreshSignInAsync(user);
        return Results.NoContent();
    }

    // Delete your User: deletes the signed-in User and everything it owns, for good, given its
    // password, so that someone using an open tab or a stolen sign-in can't. A wrong password counts
    // towards the same lockout as a failed sign-in, and a locked email is refused with Sign in's
    // message, even with the right password, as at Change password. The Guest is shared by every
    // visitor, so nobody can delete it. The User's AI requests and sent reset emails are kept with no
    // User, so that the caps on all Users together still count them.
    private static async Task<IResult> DeleteYourUser(
        DeleteYourUserRequest request,
        ClaimsPrincipal principal,
        UserManager<IdentityUser> userManager,
        SignInManager<IdentityUser> signInManager,
        AppDbContext db)
    {
        if (Guest.Is(principal.Identity!.Name!))
            return Results.Problem(detail: "The Guest can't be deleted.", statusCode: StatusCodes.Status403Forbidden);

        var password = request.Password ?? "";
        if (password.Length == 0)
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["password"] = ["Password is required."] });

        // Only a signed-in User gets here, and the security stamp check has just found it.
        var user = (await userManager.GetUserAsync(principal))!;

        // As at Sign in, a locked email is refused before its password is tried, and the failure that
        // locks it gets the lockout's answer.
        var check = await signInManager.CheckPasswordSignInAsync(user, password, lockoutOnFailure: true);
        if (check.IsLockedOut)
            return EmailLocked();
        if (!check.Succeeded)
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["password"] = ["Wrong password."] });

        // Under the rule-change lock, so it can't interleave with an import from another browser,
        // whose Transactions would otherwise stop the User from being deleted.
        await using (var transaction = await Categorizer.BeginRuleChangeAsync(db))
        {
            // Every row the User owns, which the query filters limit each delete to. Owners' keys are
            // Restrict, so each kind is deleted here, in an order that leaves nothing another row
            // still refers to, before the User itself.
            await db.Bookmarks.ExecuteDeleteAsync();
            await db.LastUsedFolders.ExecuteDeleteAsync();
            await db.Folders.ExecuteDeleteAsync();
            await db.Transactions.ExecuteDeleteAsync();
            await db.BankStatements.ExecuteDeleteAsync();
            await db.LatestUploads.ExecuteDeleteAsync();
            await db.CategorizationRules.ExecuteDeleteAsync();
            await db.Categories.ExecuteDeleteAsync();

            var result = await userManager.DeleteAsync(user);
            if (!result.Succeeded)
                throw new InvalidOperationException(
                    "Deleting the User failed: " + string.Join(" ", result.Errors.Select(e => e.Description)));
            await transaction.CommitAsync();
        }

        // Every other browser's sign-in as the User ends at its next request, when the security stamp
        // check finds no User (see UserSetup).
        await signInManager.SignOutAsync();
        return Results.NoContent();
    }

    // Every way the password breaks Sign up's rules, found without setting it, so that the other
    // fields can be reported along with it.
    private static async Task<List<IdentityError>> PasswordRuleErrors(
        UserManager<IdentityUser> userManager, IdentityUser user, string password)
    {
        var errors = new List<IdentityError>();
        foreach (var validator in userManager.PasswordValidators)
            errors.AddRange((await validator.ValidateAsync(userManager, user, password)).Errors);
        return errors;
    }

    private static IResult EmailLocked() =>
        Results.Problem(
            detail: "Too many failed sign-ins, so this email is locked for a few minutes. Try again later.",
            statusCode: StatusCodes.Status429TooManyRequests);

    private static IResult WrongEmailOrPassword() =>
        Results.Problem(detail: "Wrong email or password.", statusCode: StatusCodes.Status401Unauthorized);

    private static async Task<IResult> SignOut(SignInManager<IdentityUser> signInManager)
    {
        await signInManager.SignOutAsync();
        return Results.NoContent();
    }

    // Every Transaction of the User, manually-entered and imported, which Delete all Transactions
    // deletes; every rule, which Delete all rules deletes; and the imported Transactions with a
    // Category from a rule, which that then makes Uncategorized. Locked ones keep their Category, and
    // those already Uncategorized stay so.
    private static async Task<DeleteCountsResponse> DeleteCounts(AppDbContext db) =>
        new(
            await db.Transactions.CountAsync(),
            await db.CategorizationRules.CountAsync(),
            await db.Transactions.CountAsync(Categorizer.IsCategorizedByARule));

    // The trimmed email and the password, and an error for each that is missing.
    private static (string Email, string Password, Dictionary<string, string[]> Errors) ValidateRequired(CredentialsRequest request)
    {
        var errors = new Dictionary<string, string[]>();
        var email = request.Email?.Trim() ?? "";
        var password = request.Password ?? "";

        if (email.Length == 0)
            errors["email"] = ["Email is required."];
        if (password.Length == 0)
            errors["password"] = ["Password is required."];

        return (email, password, errors);
    }

    // Identity's errors as the app's own messages, keyed on the request's fields, one per field.
    // Choosing a new password after a Password reset gives the same messages for a password.
    internal static Dictionary<string, string[]> FieldErrors(IEnumerable<IdentityError> identityErrors)
    {
        var errors = new Dictionary<string, string[]>();
        foreach (var error in identityErrors)
        {
            var (field, message) = error.Code switch
            {
                nameof(IdentityErrorDescriber.DuplicateEmail) or nameof(IdentityErrorDescriber.DuplicateUserName) =>
                    ("email", EmailTaken),
                nameof(IdentityErrorDescriber.InvalidEmail) or nameof(IdentityErrorDescriber.InvalidUserName) =>
                    ("email", "Enter a valid email address."),
                nameof(IdentityErrorDescriber.PasswordTooShort) =>
                    ("password", $"Password must be at least {UserSetup.MinPasswordLength} characters."),
                _ when error.Code.StartsWith("Password") => ("password", error.Description),
                _ => ("email", error.Description),
            };
            errors.TryAdd(field, [message]);
        }
        return errors;
    }
}
