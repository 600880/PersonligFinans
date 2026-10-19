using System.Net;
using System.Text;
using Microsoft.AspNetCore.WebUtilities;
using PersonligFinans.Api.Emails;

namespace PersonligFinans.Api.Users;

// The email with the link to choose a new password, in English like the rest of the app.
public static class PasswordResetEmail
{
    public const string Subject = "Reset your PersonligFinans password";

    private const string Request =
        "Someone asked to reset the PersonligFinans password for this email, so here is a link to choose a new one:";
    private static readonly string Lifespan = $"It works for {LinkLifespan(UserSetup.PasswordResetLinkHours)}.";
    private const string Ignore = "If you didn't ask for this, ignore this email.";

    // The email to the User's email, with a link holding that email and the reset token.
    public static OutgoingEmail To(string email, string token, string appUrl)
    {
        var link = Link(email, token, appUrl);
        var plainText = $"{Request}\n\n{link}\n\n{Lifespan}\n\n{Ignore}\n";
        var html =
            $"<p>{WebUtility.HtmlEncode(Request)}</p>\n" +
            $"<p><a href=\"{WebUtility.HtmlEncode(link)}\">Choose a new password</a></p>\n" +
            $"<p>{WebUtility.HtmlEncode(Lifespan)}</p>\n" +
            $"<p>{WebUtility.HtmlEncode(Ignore)}</p>\n";
        return new OutgoingEmail(email, Subject, plainText, html);
    }

    // "1 hour" or, say, "2 hours", as the landing page says it too.
    private static string LinkLifespan(int hours) => hours == 1 ? "1 hour" : $"{hours} hours";

    // The page to choose a new password, on the app's configured address. It is never built from
    // the request's Host, which whoever sends the request chooses, so a forged request can't send a
    // User's link to another site. Identity's token may hold characters a URL can't, so it is
    // base64url-encoded, and both values are URL-encoded.
    private static string Link(string email, string token, string appUrl)
    {
        var encodedToken = WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(token));
        return $"{appUrl.TrimEnd('/')}/reset-password" +
            $"?email={Uri.EscapeDataString(email)}&token={Uri.EscapeDataString(encodedToken)}";
    }

    // The token Identity gave, from the base64url a link holds it in, or null when it isn't
    // base64url, which makes it a link nobody was sent.
    public static string? DecodedToken(string encodedToken)
    {
        try
        {
            return Encoding.UTF8.GetString(WebEncoders.Base64UrlDecode(encodedToken));
        }
        catch (FormatException)
        {
            return null;
        }
    }
}
