using System.Security.Claims;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using PersonligFinans.Api.Data;

namespace PersonligFinans.Api.Users;

public record CredentialsRequest(string? Email, string? Password);

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
        foreach (var validator in userManager.PasswordValidators)
            identityErrors.AddRange((await validator.ValidateAsync(userManager, user, password)).Errors);
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
            return Results.Problem(
                detail: "Too many failed sign-ins, so this email is locked for a few minutes. Try again later.",
                statusCode: StatusCodes.Status429TooManyRequests);
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

    private static IResult WrongEmailOrPassword() =>
        Results.Problem(detail: "Wrong email or password.", statusCode: StatusCodes.Status401Unauthorized);

    private static async Task<IResult> SignOut(SignInManager<IdentityUser> signInManager)
    {
        await signInManager.SignOutAsync();
        return Results.NoContent();
    }

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
