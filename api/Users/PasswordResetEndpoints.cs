using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using PersonligFinans.Api.Emails;

namespace PersonligFinans.Api.Users;

// Whether Password reset is available: only when an email sender is configured, since the link to
// choose a new password goes out by email. LinkHours is how long a link works, which the landing
// page tells whoever asks for one.
public record PasswordResetAvailability(bool Available, int LinkHours);

public record PasswordResetRequest(string? Email);

// The email and token as the link holds them, the token still base64url-encoded, and the new password.
public record NewPasswordRequest(string? Email, string? Token, string? Password);

public static class PasswordResetEndpoints
{
    // Next to the other user endpoints. All are for anyone, since whoever asks can't sign in, and
    // like Sign in they take only JSON, which another site's form can't send.
    public static void MapPasswordResetEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api/user/password-reset").AllowAnonymous();

        // The landing page asks, to show "Forgot your password?" only when it would work.
        api.MapGet("/availability", ([FromServices] IEmailSender? emailSender) =>
            Results.Ok(new PasswordResetAvailability(emailSender is not null, UserSetup.PasswordResetLinkHours)));
        api.MapPost("/request", RequestReset);
        api.MapPost("/new-password", ChooseNewPassword);
    }

    // Sends a link to choose a new password to a User's email. Every email gets the same answer,
    // whether or not it is a User's, so nobody can find out which emails are in use. Only a User's
    // email is sent anything: never an email nobody signed up with, which would let the app be used
    // to send email to strangers, and never the Guest, which has no password, or anything else on
    // its reserved domain. The email is sent before answering, so asking for a User's email takes
    // longer than for any other; Sign in, which checks a password only for a User, already does.
    private static async Task<IResult> RequestReset(
        PasswordResetRequest request,
        UserManager<IdentityUser> userManager,
        IOptions<EmailOptions> emailOptions,
        ILoggerFactory loggerFactory,
        [FromServices] IEmailSender? emailSender)
    {
        if (emailSender is null)
            return Unavailable();

        var email = request.Email?.Trim() ?? "";
        if (email.Length == 0)
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["email"] = ["Email is required."] });
        if (Guest.IsReserved(email))
            return Results.NoContent();

        // Matched ignoring case, as Identity matches emails, and sent to the email as signed up.
        var user = await userManager.FindByEmailAsync(email);
        if (user is null)
            return Results.NoContent();

        var token = await userManager.GeneratePasswordResetTokenAsync(user);
        try
        {
            // Set whenever an email sender is: the app doesn't start without it.
            await emailSender.SendAsync(PasswordResetEmail.To(user.Email!, token, emailOptions.Value.AppUrl!));
        }
        // Saying the email failed would tell whoever asked that the email is a User's.
        catch (Exception e)
        {
            loggerFactory.CreateLogger(typeof(PasswordResetEndpoints))
                .LogError(e, "Sending a Password reset email failed.");
        }
        return Results.NoContent();
    }

    // Sets the new password chosen on the page the link opens, and signs in as the User. The link
    // works only for the User whose email it holds, until it expires or the password changes, which
    // using it does. A password that breaks the rules gets Sign up's field errors and leaves the link
    // working, so the User can try another.
    private static async Task<IResult> ChooseNewPassword(
        NewPasswordRequest request,
        UserManager<IdentityUser> userManager,
        SignInManager<IdentityUser> signInManager,
        [FromServices] IEmailSender? emailSender)
    {
        if (emailSender is null)
            return Unavailable();

        var email = request.Email?.Trim() ?? "";
        var encodedToken = request.Token?.Trim() ?? "";
        var password = request.Password ?? "";
        var errors = new Dictionary<string, string[]>();
        if (email.Length == 0)
            errors["email"] = ["Email is required."];
        if (encodedToken.Length == 0)
            errors["token"] = ["Token is required."];
        if (password.Length == 0)
            errors["password"] = ["Password is required."];
        if (errors.Count > 0)
            return Results.ValidationProblem(errors);

        // The Guest has no password, so no link can give it one.
        if (Guest.IsReserved(email))
            return LinkExpiredOrUsed();
        var user = await userManager.FindByEmailAsync(email);
        if (user is null || PasswordResetEmail.DecodedToken(encodedToken) is not { } token)
            return LinkExpiredOrUsed();

        // Identity checks the token before the password, so a password is judged only on a link that
        // works. Any other failure, such as the same link used by a request that got there first,
        // means the link is used up.
        var result = await userManager.ResetPasswordAsync(user, token, password);
        if (!result.Succeeded)
            return result.Errors.All(e => e.Code.StartsWith("Password"))
                ? Results.ValidationProblem(UserEndpoints.FieldErrors(result.Errors))
                : LinkExpiredOrUsed();

        // A reset is the way out of a lockout from failed sign-ins, which Identity's reset leaves as
        // it was, so it ends here, and the count of failures starts again from nothing.
        await userManager.SetLockoutEndDateAsync(user, null);
        await userManager.ResetAccessFailedCountAsync(user);

        // Persistent like every sign-in, and replacing whoever was signed in on this browser, the
        // Guest included. The reset changed the User's security stamp, so every other browser's
        // sign-in as the User ends at its next request (see UserSetup), while this one gets a fresh
        // cookie with the new stamp.
        await signInManager.SignInAsync(user, isPersistent: true);
        return Results.Ok(UserResponse.Of(user.Email!));
    }

    // A link that can't reset a password, whether it has expired, was already used, was changed, or
    // holds an email that isn't a User's. Saying which would tell whoever holds it whether the email
    // is a User's. 410, since the link is gone for good, tells it apart from a refused password.
    private static IResult LinkExpiredOrUsed() =>
        Results.Problem(detail: "This link has expired or was already used.", statusCode: StatusCodes.Status410Gone);

    private static IResult Unavailable() =>
        Results.Problem(detail: "Password reset is unavailable.", statusCode: StatusCodes.Status503ServiceUnavailable);
}
