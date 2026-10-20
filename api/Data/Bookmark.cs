namespace PersonligFinans.Api.Data;

// A mark a User puts on a Transaction to find it again. It changes nothing about the Transaction.
public class Bookmark
{
    public int Id { get; set; }

    // The User it belongs to.
    public required string UserId { get; set; }

    // The Transaction it marks, which has at most one Bookmark. Deleting the Transaction deletes it.
    public int TransactionId { get; set; }

    // The Folder it is filed in. Null means in no Folder, which the app lists as "Bookmarks". There are
    // no Folders yet, so it is always null, and there is no foreign key to them.
    public int? FolderId { get; set; }
}
