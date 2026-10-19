namespace PersonligFinans.Api.Data;

public class Category
{
    public int Id { get; set; }

    // The User it belongs to.
    public required string UserId { get; set; }

    // Unique among the User's Categories, ignoring case.
    public required string Name { get; set; }

    // What belongs in the Category.
    public required string Description { get; set; }

    // The colour the Dashboard draws the Category in, as #rrggbb.
    public required string Colour { get; set; }

    // A Built-in Category, which the app depends on: the user may change its description, but
    // never rename or delete it.
    public bool BuiltIn { get; set; }
}
