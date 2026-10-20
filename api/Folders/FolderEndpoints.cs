using Microsoft.EntityFrameworkCore;
using Npgsql;
using PersonligFinans.Api.Data;

namespace PersonligFinans.Api.Folders;

public record FolderRequest(string? Name);

public record FolderResponse(int Id, string Name);

public static class FolderEndpoints
{
    // How the app lists the Bookmarks in no Folder, so no Folder may be named it, in any case.
    private const string NoFolderName = "Bookmarks";

    public static void MapFolderEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api/folders");

        // By name in the Norwegian alphabet, ignoring case, like the Categories. The client sorts an
        // added Folder the same way.
        api.MapGet("/", async (AppDbContext db) =>
            (await db.Folders.Select(f => new FolderResponse(f.Id, f.Name)).ToListAsync())
            .OrderBy(f => f.Name, NorwegianAlphabet.IgnoringCase)
            .ToList());

        api.MapPost("/", AddFolder);
    }

    // A new Folder has no Bookmarks yet.
    private static async Task<IResult> AddFolder(FolderRequest request, AppDbContext db)
    {
        var name = request.Name?.Trim() ?? "";
        if (await NameError(db, name) is { } error)
            return NameProblem(error);

        var folder = new Folder { UserId = db.OwnerOfNewRows, Name = name };
        db.Folders.Add(folder);
        try
        {
            await db.SaveChangesAsync();
        }
        // The name was taken concurrently, between validation and now.
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            return NameProblem(AlreadyExists(await FindByName(db, name) ?? name));
        }

        return Results.Created($"/api/folders/{folder.Id}", new FolderResponse(folder.Id, folder.Name));
    }

    // Why the trimmed name can't be a Folder's, or null when it can.
    private static async Task<string?> NameError(AppDbContext db, string name)
    {
        if (name.Length == 0)
            return "Name is required.";
        if (name.Length > AppDbContext.FolderNameMaxLength)
            return $"Name must be at most {AppDbContext.FolderNameMaxLength} characters.";
        if (string.Equals(name, NoFolderName, StringComparison.OrdinalIgnoreCase))
            return $"A folder can't be named '{NoFolderName}'.";
        if (await FindByName(db, name) is { } existing)
            return AlreadyExists(existing);
        return null;
    }

    private static IResult NameProblem(string message) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { ["name"] = [message] });

    // Names are unique among the User's Folders ignoring case, so this finds the name as it was
    // originally typed.
    private static Task<string?> FindByName(AppDbContext db, string name) =>
        db.Folders
            .Where(f => f.Name.ToLower() == name.ToLower())
            .Select(f => f.Name)
            .FirstOrDefaultAsync();

    private static string AlreadyExists(string name) => $"A folder named '{name}' already exists.";
}
