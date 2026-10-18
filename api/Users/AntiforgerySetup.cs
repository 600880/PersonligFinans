using Microsoft.AspNetCore.Antiforgery;

namespace PersonligFinans.Api.Users;

public record AntiforgeryTokenResponse(string Token);

// The sign-in cookie goes with every request to the API. A multipart form is the one kind of request
// another site's page can send the API without a CORS preflight, so the endpoints that take one check
// an antiforgery token too, on top of the SameSite cookie. The JSON endpoints need none: another site
// can't send JSON without a preflight, which the API never grants.
public static class AntiforgerySetup
{
    // The header the client sends the token in.
    public const string HeaderName = "X-CSRF-TOKEN";

    public static IServiceCollection AddAntiforgeryTokens(this IServiceCollection services) =>
        services.AddAntiforgery(options =>
        {
            options.HeaderName = HeaderName;
            // Like the sign-in cookie, only ever sent over HTTPS.
            options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
        });

    // Anyone may ask for a token, but it is bound to whoever is signed in when it is given, so the
    // client asks after signing in.
    public static void MapAntiforgeryTokenEndpoint(this IEndpointRouteBuilder app) =>
        app.MapGet("/api/antiforgery-token", (HttpContext context, IAntiforgery antiforgery) =>
                Results.Ok(new AntiforgeryTokenResponse(antiforgery.GetAndStoreTokens(context).RequestToken!)))
            .AllowAnonymous();

    // Makes the antiforgery middleware check the endpoint's requests, which it otherwise does only for
    // endpoints that bind a form, and refuses one without a valid token with 403. The client then
    // fetches a fresh token and tries once more.
    public static RouteHandlerBuilder RequireAntiforgeryToken(this RouteHandlerBuilder endpoint) =>
        endpoint
            .WithMetadata(new RequireAntiforgeryTokenAttribute())
            .AddEndpointFilter(async (context, next) =>
                context.HttpContext.Features.Get<IAntiforgeryValidationFeature>() is { IsValid: false }
                    ? Results.Problem(
                        detail: "The request's antiforgery token is missing or not valid.",
                        statusCode: StatusCodes.Status403Forbidden)
                    : await next(context));
}
