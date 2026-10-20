using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;

namespace PersonligFinans.Api.Tests;

// Files Bookmarks in Folders straight in the database, for the tests of what a Folder lists, since
// the API can't file Bookmarks yet.
public static class BookmarkFiling
{
    // Files the Bookmark on the Transaction of the User who signed up with the email in the Folder.
    public static async Task FileBookmarkAsync(
        this WebApplicationFactory<Program> factory, string email, int transactionId, int folderId)
    {
        await using var user = await UserDatabase.OfAsync(factory, email);
        var bookmark = await user.Db.Bookmarks.SingleAsync(b => b.TransactionId == transactionId);
        bookmark.FolderId = folderId;
        await user.Db.SaveChangesAsync();
    }
}
