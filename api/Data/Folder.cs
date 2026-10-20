namespace PersonligFinans.Api.Data;

// A named group a User files Bookmarks in, such as "Tax deductible".
public class Folder
{
    public int Id { get; set; }

    // The User it belongs to.
    public required string UserId { get; set; }

    // Unique among the User's Folders, ignoring case, and never "Bookmarks", which is how the app lists
    // the Bookmarks in no Folder.
    public required string Name { get; set; }
}
