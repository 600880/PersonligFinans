using System.Security.Claims;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace PersonligFinans.Api.Users;

public record UserRequest(string? Email, string? Password);

// The signed-in User, by the email they registered with.
public record UserResponse(string Email);

public static class UserEndpoints
{
    // Identity's limit on a user name and an email.
    private const int MaxEmailLength = 256;

    private const string EmailTaken = "This email is already registered.";

    public static void MapUserEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api/user");

        // Who is signed in. Signed out, the fallback policy answers 401 before this runs, which is
        // how the client knows to show its landing page.
        api.MapGet("/", (ClaimsPrincipal user) => Results.Ok(new UserResponse(user.Identity!.Name!)));

        // Signing in, and signing out, are for anyone; signing out when signed out does nothing.
        api.MapPost("/register", Register).AllowAnonymous();
        api.MapPost("/log-in", LogIn).AllowAnonymous();
        api.MapPost("/log-out", LogOut).AllowAnonymous();
    }

    // Creates a User whose user name is their email, and signs it in.
    private static async Task<IResult> Register(
        UserRequest request, UserManager<IdentityUser> userManager, SignInManager<IdentityUser> signInManager)
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
        if (identityErrors.Count > 0)
            return Results.ValidationProblem(FieldErrors(identityErrors));

        IdentityResult result;
        try
        {
            result = await userManager.CreateAsync(user, password);
        }
        // The email was registered concurrently, between validation and now.
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["email"] = [EmailTaken] });
        }
        if (!result.Succeeded)
            return Results.ValidationProblem(FieldErrors(result.Errors));

        await signInManager.SignInAsync(user, isPersistent: true);
        return Results.Ok(new UserResponse(email));
    }

    // Signs in with an email and password. A wrong email and a wrong password get the same answer, so
    // nobody can find out which emails are registered. Every failure counts towards locking the
    // email, and a locked email is refused, even with the right password, until the lockout ends.
    private static async Task<IResult> LogIn(
        UserRequest request, UserManager<IdentityUser> userManager, SignInManager<IdentityUser> signInManager)
    {
        var (email, password, errors) = ValidateRequired(request);
        if (errors.Count > 0)
            return Results.ValidationProblem(errors);

        var result = await signInManager.PasswordSignInAsync(email, password, isPersistent: true, lockoutOnFailure: true);
        if (result.IsLockedOut)
            return Results.Problem(
                detail: "Too many failed log-ins, so this email is locked for a few minutes. Try again later.",
                statusCode: StatusCodes.Status429TooManyRequests);
        if (!result.Succeeded)
            return Results.Problem(
                detail: "Wrong email or password.",
                statusCode: StatusCodes.Status401Unauthorized);

        // The email as registered, whatever its case when logging in.
        var user = await userManager.FindByNameAsync(email);
        return Results.Ok(new UserResponse(user!.Email!));
    }

    private static async Task<IResult> LogOut(SignInManager<IdentityUser> signInManager)
    {
        await signInManager.SignOutAsync();
        return Results.NoContent();
    }

    // The trimmed email and the password, and an error for each that is missing.
    private static (string Email, string Password, Dictionary<string, string[]> Errors) ValidateRequired(UserRequest request)
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
    private static Dictionary<string, string[]> FieldErrors(IEnumerable<IdentityError> identityErrors)
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
