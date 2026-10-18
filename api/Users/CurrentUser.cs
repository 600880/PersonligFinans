using System.Security.Claims;

namespace PersonligFinans.Api.Users;

// The User whose data a scope's database context sees and changes: in a request, the signed-in User,
// or nobody when signed out. Work that runs outside a request, such as the re-matching at start-up,
// names the User it acts as.
public sealed class CurrentUser(IHttpContextAccessor httpContextAccessor)
{
    private string? _actingAs;

    // The User's id, or null for nobody.
    public string? Id => _actingAs ?? httpContextAccessor.HttpContext?.User.FindFirstValue(ClaimTypes.NameIdentifier);

    // Makes the scope act as the User with the given id, whoever is signed in.
    public void ActAs(string userId) => _actingAs = userId;
}
