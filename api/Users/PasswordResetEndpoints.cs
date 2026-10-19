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
        PasswordResetEmailLedger ledger,
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

        // Over a cap the answer is the same and nothing is sent, so the caps don't reveal which
        // emails are in use either. The ledger logs which cap was reached.
        if (!await ledger.TryTakeAsync(user.Id))
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

    private static IResult Unavailable() =>
        Results.Problem(detail: "Password reset is unavailable.", statusCode: StatusCodes.Status503ServiceUnavailable);
}
