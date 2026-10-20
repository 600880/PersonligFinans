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
        api.MapPut("/{id:int}", RenameFolder);
        api.MapDelete("/{id:int}", DeleteFolder);
    }

    // A new Folder has no Bookmarks yet.
    private static async Task<IResult> AddFolder(FolderRequest request, AppDbContext db)
    {
        var name = request.Name?.Trim() ?? "";
        if (await NameError(db, name, renamedFolderId: null) is { } error)
            return NameProblem(error);

        var folder = new Folder { UserId = db.OwnerOfNewRows, Name = name };
        db.Folders.Add(folder);
        if (!await SaveFolder(db))
            return await NameAlreadyExists(db, name);

        return Results.Created($"/api/folders/{folder.Id}", new FolderResponse(folder.Id, folder.Name));
    }

    // The same rules as a new name, except that the Folder's own name doesn't count as taken, so only
    // its letter case can change.
    private static async Task<IResult> RenameFolder(int id, FolderRequest request, AppDbContext db)
    {
        var folder = await db.Folders.FindAsync(id);
        if (folder is null)
            return Results.NotFound();

        var name = request.Name?.Trim() ?? "";
        if (await NameError(db, name, renamedFolderId: id) is { } error)
            return NameProblem(error);

        folder.Name = name;
        if (!await SaveFolder(db))
            return await NameAlreadyExists(db, name);

        return Results.Ok(new FolderResponse(folder.Id, folder.Name));
    }

    // Its Bookmarks are deleted with it, through the foreign key's cascade, but never their Transactions.
    private static async Task<IResult> DeleteFolder(int id, AppDbContext db) =>
        await db.Folders.Where(f => f.Id == id).ExecuteDeleteAsync() == 0
            ? Results.NotFound()
            : Results.NoContent();

    // Why the trimmed name can't be a Folder's, or null when it can. The renamed Folder's own name, if
    // any, isn't taken.
    private static async Task<string?> NameError(AppDbContext db, string name, int? renamedFolderId)
    {
        if (name.Length == 0)
            return "Name is required.";
        if (name.Length > AppDbContext.FolderNameMaxLength)
            return $"Name must be at most {AppDbContext.FolderNameMaxLength} characters.";
        if (string.Equals(name, NoFolderName, StringComparison.OrdinalIgnoreCase))
            return $"A folder can't be named '{NoFolderName}'.";
        if (await FindByName(db, name, renamedFolderId) is { } existing)
            return AlreadyExists(existing);
        return null;
    }

    private static IResult NameProblem(string message) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { ["name"] = [message] });

    // Returns false when the name was taken concurrently, between validation and now.
    private static async Task<bool> SaveFolder(AppDbContext db)
    {
        try
        {
            await db.SaveChangesAsync();
            return true;
        }
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            return false;
        }
    }

    private static async Task<IResult> NameAlreadyExists(AppDbContext db, string name) =>
        NameProblem(AlreadyExists(await FindByName(db, name, renamedFolderId: null) ?? name));

    // Names are unique among the User's Folders ignoring case, so this finds the name as it was
    // originally typed, among the Folders other than the renamed one.
    private static Task<string?> FindByName(AppDbContext db, string name, int? renamedFolderId) =>
        db.Folders
            .Where(f => f.Id != renamedFolderId && f.Name.ToLower() == name.ToLower())
            .Select(f => f.Name)
            .FirstOrDefaultAsync();

    private static string AlreadyExists(string name) => $"A folder named '{name}' already exists.";
}
