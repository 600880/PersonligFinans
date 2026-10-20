using Microsoft.EntityFrameworkCore;
using Npgsql;
using PersonligFinans.Api.Data;
using PersonligFinans.Api.Transactions;

namespace PersonligFinans.Api.Bookmarks;

// FolderId is the Folder to file the Bookmark in, or null for none.
public record FileBookmarkRequest(int? FolderId);

// FolderId is the Folder the Bookmark is filed in, or null for none.
public record BookmarkResponse(int? FolderId);

public static class BookmarkEndpoints
{
    public static void MapBookmarkEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api");

        api.MapPost("/transactions/{id:int}/bookmark", AddBookmark);
        api.MapPut("/transactions/{id:int}/bookmark", FileBookmark);
        api.MapDelete("/transactions/{id:int}/bookmark", RemoveBookmark);

        api.MapGet("/bookmarks", ListBookmarks);
    }

    // The bookmarked Transactions in the Folder, or in no Folder without one, from any date, listed
    // like a Period's.
    private static async Task<IResult> ListBookmarks(int? folderId, AppDbContext db)
    {
        if (folderId is not null && !await db.Folders.AnyAsync(f => f.Id == folderId))
            return Results.NotFound();

        return Results.Ok(await TransactionEndpoints.ListNewestFirst(
            db.Transactions.Where(t => db.Bookmarks.Any(b => b.TransactionId == t.Id && b.FolderId == folderId)),
            db));
    }

    // Bookmarks the Transaction in the User's last used folder, which only filing changes, so adding
    // never does. One already bookmarked is left as it is and answers with its Folder, so a double
    // click never makes a copy or moves it. Changes nothing about the Transaction itself.
    private static async Task<IResult> AddBookmark(int id, AppDbContext db)
    {
        if (!await db.Transactions.AnyAsync(t => t.Id == id))
            return Results.NotFound();

        if (await BookmarkOf(db, id) is { } existing)
            return Results.Ok(existing);

        // No row means "Bookmarks", as a null Folder does.
        var folderId = await db.LastUsedFolders.Select(l => l.FolderId).SingleOrDefaultAsync();
        db.Bookmarks.Add(new Bookmark { UserId = db.OwnerOfNewRows, TransactionId = id, FolderId = folderId });
        try
        {
            await db.SaveChangesAsync();
        }
        // Bookmarked concurrently, between the check and now: that Bookmark stands.
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            db.ChangeTracker.Clear();
            return Results.Ok(await BookmarkOf(db, id));
        }

        return Results.Ok(new BookmarkResponse(folderId));
    }

    // Files the Transaction's Bookmark in the Folder, or in none, bookmarking it first if it isn't, and
    // makes that the User's last used folder, so the next Bookmark goes there too.
    private static async Task<IResult> FileBookmark(int id, FileBookmarkRequest request, AppDbContext db)
    {
        if (!await db.Transactions.AnyAsync(t => t.Id == id))
            return Results.NotFound();

        // Another visitor of the Guest, or another tab, may have deleted it since the list was shown.
        if (request.FolderId is not null && !await db.Folders.AnyAsync(f => f.Id == request.FolderId))
            return Results.ValidationProblem(
                new Dictionary<string, string[]> { ["folderId"] = ["The folder no longer exists."] });

        var bookmark = await db.Bookmarks.SingleOrDefaultAsync(b => b.TransactionId == id);
        if (bookmark is null)
            db.Bookmarks.Add(new Bookmark { UserId = db.OwnerOfNewRows, TransactionId = id, FolderId = request.FolderId });
        else
            bookmark.FolderId = request.FolderId;

        await MakeLastUsedFolder(db, request.FolderId);

        try
        {
            await db.SaveChangesAsync();
        }
        // Bookmarked, or a first last used folder recorded, concurrently, between the lookups and now:
        // filing again finds those rows and changes them instead.
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            db.ChangeTracker.Clear();
            return await FileBookmark(id, request, db);
        }

        return Results.Ok(new BookmarkResponse(request.FolderId));
    }

    // Removes the Transaction's Bookmark. One that isn't bookmarked ends the same way, so it answers
    // the same.
    private static async Task<IResult> RemoveBookmark(int id, AppDbContext db)
    {
        if (!await db.Transactions.AnyAsync(t => t.Id == id))
            return Results.NotFound();

        await db.Bookmarks.Where(b => b.TransactionId == id).ExecuteDeleteAsync();

        return Results.NoContent();
    }

    // Makes the Folder, or none for null, the User's last used folder when the context is next saved.
    // A first one recorded concurrently makes that save fail with a unique violation.
    internal static async Task MakeLastUsedFolder(AppDbContext db, int? folderId)
    {
        var lastUsed = await db.LastUsedFolders.SingleOrDefaultAsync();
        if (lastUsed is null)
            db.LastUsedFolders.Add(new LastUsedFolder { UserId = db.OwnerOfNewRows, FolderId = folderId });
        else
            lastUsed.FolderId = folderId;
    }

    // The Transaction's Bookmark as a response, or null when it isn't bookmarked.
    private static Task<BookmarkResponse?> BookmarkOf(AppDbContext db, int transactionId) =>
        db.Bookmarks
            .Where(b => b.TransactionId == transactionId)
            .Select(b => new BookmarkResponse(b.FolderId))
            .SingleOrDefaultAsync();
}
