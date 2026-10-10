namespace PersonligFinans.Api.Data;

public class Category
{
    public int Id { get; set; }

    // Unique, ignoring case.
    public required string Name { get; set; }

    // What belongs in the Category.
    public required string Description { get; set; }

    // A Built-in Category, which the app depends on: the user may change its description, but
    // never rename or delete it.
    public bool BuiltIn { get; set; }
}
