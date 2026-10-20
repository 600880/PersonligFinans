namespace PersonligFinans.Api.Data;

// The Folder a User last filed a Bookmark in, which new Bookmarks go into. Each User has at most one.
// Kept on the server rather than in the browser, so two Users on one browser never share it.
public class LastUsedFolder
{
    public int Id { get; set; }

    // The User it belongs to.
    public required string UserId { get; set; }

    // Null means no Folder, which the app lists as "Bookmarks", as does a User without a row.
    // Deleting the Folder sets it to null.
    public int? FolderId { get; set; }
}
