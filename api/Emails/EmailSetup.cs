using Azure.Communication.Email;
using Azure.Identity;

namespace PersonligFinans.Api.Emails;

// The Email configuration section. Endpoint is the Communication Services resource that sends
// email, e.g. https://<resource>.<region>.communication.azure.com, Sender the address it sends from,
// e.g. DoNotReply@<guid>.azurecomm.net, and AppUrl the app's own address, which every link in an
// email starts from, e.g. https://personligfinans-ds.azurewebsites.net.
public sealed class EmailOptions
{
    public string? Endpoint { get; set; }

    public string? Sender { get; set; }

    public string? AppUrl { get; set; }
}

public static class EmailSetup
{
    public const string SectionName = "Email";

    // Registers the Communication Services email sender when Email:Endpoint is configured. Without
    // an endpoint none is registered, so Password reset is unavailable, as in local development and
    // tests. With an endpoint, a missing sender or app address stops the app at start-up, so a
    // half-done configuration is caught on deploy rather than by a User asking for a reset. It
    // authenticates with DefaultAzureCredential: the App Service's managed identity in production,
    // `az login` locally.
    public static IServiceCollection AddEmail(this IServiceCollection services, IConfiguration configuration)
    {
        var section = configuration.GetSection(SectionName);
        services.AddOptions<EmailOptions>().Bind(section);

        var options = section.Get<EmailOptions>() ?? new EmailOptions();
        var endpoint = options.Endpoint;
        if (string.IsNullOrWhiteSpace(endpoint))
            return services;

        var sender = options.Sender;
        if (string.IsNullOrWhiteSpace(sender))
            throw new InvalidOperationException(
                $"'{SectionName}:Endpoint' is set, but '{SectionName}:{nameof(EmailOptions.Sender)}' is not. " +
                "Set it to the sender address of the Email Communication Services domain, e.g. DoNotReply@<guid>.azurecomm.net.");

        if (!Uri.TryCreate(options.AppUrl, UriKind.Absolute, out var uri) || (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp))
            throw new InvalidOperationException(
                $"'{SectionName}:Endpoint' is set, but '{SectionName}:{nameof(EmailOptions.AppUrl)}' is not the app's address. " +
                "Set it to the address emails link to, e.g. https://personligfinans-ds.azurewebsites.net.");

        var client = new EmailClient(new Uri(endpoint), new DefaultAzureCredential());
        return services.AddSingleton<IEmailSender>(new AcsEmailSender(client, sender));
    }
}
