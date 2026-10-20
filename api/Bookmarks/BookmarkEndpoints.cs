using Microsoft.EntityFrameworkCore;
using Npgsql;
using PersonligFinans.Api.Data;
using PersonligFinans.Api.Transactions;

namespace PersonligFinans.Api.Bookmarks;

// FolderId is the Folder the Bookmark is filed in, or null for none.
public record BookmarkResponse(int? FolderId);

public static class BookmarkEndpoints
{
    public static void MapBookmarkEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api");

        api.MapPost("/transactions/{id:int}/bookmark", AddBookmark);
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

    // Bookmarks the Transaction in no Folder. One already bookmarked is left as it is and answers with
    // its Folder, so a double click never makes a copy or moves it. Changes nothing about the
    // Transaction itself.
    private static async Task<IResult> AddBookmark(int id, AppDbContext db)
    {
        if (!await db.Transactions.AnyAsync(t => t.Id == id))
            return Results.NotFound();

        if (await BookmarkOf(db, id) is { } existing)
            return Results.Ok(existing);

        db.Bookmarks.Add(new Bookmark { UserId = db.OwnerOfNewRows, TransactionId = id });
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

        return Results.Ok(new BookmarkResponse(FolderId: null));
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

    // The Transaction's Bookmark as a response, or null when it isn't bookmarked.
    private static Task<BookmarkResponse?> BookmarkOf(AppDbContext db, int transactionId) =>
        db.Bookmarks
            .Where(b => b.TransactionId == transactionId)
            .Select(b => new BookmarkResponse(b.FolderId))
            .SingleOrDefaultAsync();
}
