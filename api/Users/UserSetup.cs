using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using PersonligFinans.Api.Data;

namespace PersonligFinans.Api.Users;

public static class UserSetup
{
    public const int MinPasswordLength = 8;
    public const int MaxFailedLogIns = 5;
    public static readonly TimeSpan LockoutDuration = TimeSpan.FromMinutes(5);

    // Users sign in with ASP.NET Core Identity, stored in the app's database, and stay signed in
    // through Identity's application cookie. The client is served from the same origin as the API,
    // so the cookie needs no CORS and the app never hands out bearer tokens. Signing in is required
    // everywhere unless an endpoint allows anonymous access.
    public static IServiceCollection AddUsers(this IServiceCollection services)
    {
        // Registers the application cookie and Identity's other cookies, which signing out also
        // clears.
        services.AddAuthentication(IdentityConstants.ApplicationScheme).AddIdentityCookies();

        // No email confirmation, password reset or email sender, so no token providers either.
        services.AddIdentityCore<IdentityUser>(options =>
            {
                // A long passphrase is as good as any symbol rule, so length is all that counts.
                options.Password.RequiredLength = MinPasswordLength;
                options.Password.RequireDigit = false;
                options.Password.RequireLowercase = false;
                options.Password.RequireUppercase = false;
                options.Password.RequireNonAlphanumeric = false;

                // The email is the user name. Identity matches both by their normalized form, so
                // emails are unique, and log-in matches them, ignoring case. The email is validated
                // as an email, so the user name needn't be limited to Identity's default characters.
                options.User.RequireUniqueEmail = true;
                options.User.AllowedUserNameCharacters = "";

                // Guessing a password takes many tries, so a few failures lock the email for a while.
                options.Lockout.MaxFailedAccessAttempts = MaxFailedLogIns;
                options.Lockout.DefaultLockoutTimeSpan = LockoutDuration;
                options.Lockout.AllowedForNewUsers = true;
            })
            .AddEntityFrameworkStores<AppDbContext>()
            .AddSignInManager();

        services.ConfigureApplicationCookie(options =>
        {
            // Out of reach of scripts, only ever sent over HTTPS, and not sent with cross-site
            // requests other than top-level navigation.
            options.Cookie.HttpOnly = true;
            options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
            options.Cookie.SameSite = SameSiteMode.Lax;

            // Every sign-in is persistent, so a User stays signed in for 14 days after last using
            // the app.
            options.ExpireTimeSpan = TimeSpan.FromDays(14);
            options.SlidingExpiration = true;

            // An API has no log-in page to send anyone to: signed out is 401, and not allowed is 403.
            // The client shows its landing page on a 401.
            options.Events.OnRedirectToLogin = context =>
            {
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                return Task.CompletedTask;
            };
            options.Events.OnRedirectToAccessDenied = context =>
            {
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                return Task.CompletedTask;
            };
        });

        // Who the database context works for.
        services.AddHttpContextAccessor();
        services.AddScoped<CurrentUser>();

        services.AddAuthorizationBuilder()
            .SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build());

        return services;
    }
}
