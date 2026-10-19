using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using PersonligFinans.Api.Data;

namespace PersonligFinans.Api.Users;

public static class UserSetup
{
    public const int MinPasswordLength = 8;
    public const int MaxFailedSignIns = 5;
    public static readonly TimeSpan LockoutDuration = TimeSpan.FromMinutes(5);
    // How long a link to choose a new password works. Whole hours, since the email and the landing
    // page both say it in hours.
    public const int PasswordResetLinkHours = 1;

    // Users sign in with ASP.NET Core Identity, stored in the app's database, and stay signed in
    // through Identity's application cookie. The client is served from the same origin as the API,
    // so the cookie needs no CORS and the app never hands out bearer tokens. Signing in is required
    // everywhere unless an endpoint allows anonymous access.
    public static IServiceCollection AddUsers(this IServiceCollection services)
    {
        // Registers the application cookie and Identity's other cookies, which signing out also
        // clears.
        services.AddAuthentication(IdentityConstants.ApplicationScheme).AddIdentityCookies();

        services.AddIdentityCore<IdentityUser>(options =>
            {
                // A long passphrase is as good as any symbol rule, so length is all that counts.
                options.Password.RequiredLength = MinPasswordLength;
                options.Password.RequireDigit = false;
                options.Password.RequireLowercase = false;
                options.Password.RequireUppercase = false;
                options.Password.RequireNonAlphanumeric = false;

                // The email is the user name. Identity matches both by their normalized form, so
                // emails are unique, and signing in matches them, ignoring case. The email is validated
                // as an email, so the user name needn't be limited to Identity's default characters.
                options.User.RequireUniqueEmail = true;
                options.User.AllowedUserNameCharacters = "";

                // Guessing a password takes many tries, so a few failures lock the email for a while.
                options.Lockout.MaxFailedAccessAttempts = MaxFailedSignIns;
                options.Lockout.DefaultLockoutTimeSpan = LockoutDuration;
                options.Lockout.AllowedForNewUsers = true;
            })
            .AddEntityFrameworkStores<AppDbContext>()
            .AddSignInManager()
            // The Password reset's token, the only token the app gives out: there is no email
            // confirmation, two-factor sign-in or change of email. So only the data-protection
            // provider is registered, as the default provider the reset uses, rather than Identity's
            // whole set of default providers.
            .AddTokenProvider<DataProtectorTokenProvider<IdentityUser>>(TokenOptions.DefaultProvider);

        // These options cover every data-protection token, and only the Password reset gives any out.
        services.Configure<DataProtectionTokenProviderOptions>(options =>
            options.TokenLifespan = TimeSpan.FromHours(PasswordResetLinkHours));

        // Every request checks its sign-in cookie's security stamp against the User's, rather than
        // only every 30 minutes, Identity's default. A Password reset changes the stamp, so whoever
        // was signed in as the User elsewhere, perhaps with the old password, is signed out at their
        // very next request. It costs a small read of the User per request, and a refreshed cookie
        // with each answer.
        services.Configure<SecurityStampValidatorOptions>(options => options.ValidationInterval = TimeSpan.Zero);

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

            // An API has no sign-in page to send anyone to: signed out is 401, and not allowed is 403.
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
