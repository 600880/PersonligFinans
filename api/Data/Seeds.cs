namespace PersonligFinans.Api.Data;

// What every new User starts with: the seeded Categories, the Built-in ones among them, and the
// seeded Categorization Rules. Each User gets copies of their own when they are created, which they
// may then change like any others.
public static class Seeds
{
    public record SeedCategory(string Name, string Description, string Colour, bool BuiltIn = false);

    public static readonly IReadOnlyList<SeedCategory> Categories =
    [
        new("Groceries", "All groceries.", "#2a78d6", BuiltIn: true),
        new("Transport", "All expenses related to car and public transport.", "#1baf7a", BuiltIn: true),
        new("Housing", "Mortgage, common costs and insurance.", "#eda100", BuiltIn: true),
        new("Income", "All income.", "#8a5a1c", BuiltIn: true),
        new("Transfers", "All private transfers.", "#0f766e", BuiltIn: true),
        new("Other", "Costs that don't belong in any other category.", "#9085e9", BuiltIn: true),
        new("Clothing", "All clothing, including sportswear.", "#b8336a", BuiltIn: true),
    ];

    // Common merchants, each with the name of its seeded Category.
    public static readonly IReadOnlyList<(string Keyword, string CategoryName)> Rules =
    [
        ("rema", "Groceries"), ("kiwi", "Groceries"), ("coop extra", "Groceries"), ("meny", "Groceries"),
        ("joker", "Groceries"), ("bunnpris", "Groceries"),
        ("vy", "Transport"), ("skyss", "Transport"), ("ruter", "Transport"),
        ("cubus", "Clothing"), ("dressmann", "Clothing"), ("h&m", "Clothing"),
        ("overføring mellom egne kontoer", "Transfers"), ("overføring til konto", "Transfers"),
    ];

    // The order the Built-in Categories are listed in, ahead of every other Category.
    public static readonly string[] BuiltInOrder =
        ["Housing", "Groceries", "Clothing", "Transport", "Other", "Income", "Transfers"];

    // Adds copies of the seeded Categories and Categorization Rules owned by the User, each rule with
    // that User's Category of its name. Nothing is saved.
    public static void AddTo(AppDbContext db, string userId)
    {
        var categories = Categories.ToDictionary(
            seed => seed.Name,
            seed => new Category
            {
                Name = seed.Name,
                Description = seed.Description,
                Colour = seed.Colour,
                BuiltIn = seed.BuiltIn,
                UserId = userId,
            });
        db.Categories.AddRange(categories.Values);

        var now = DateTimeOffset.UtcNow;
        db.CategorizationRules.AddRange(Rules.Select(seed => new CategorizationRule
        {
            Keyword = seed.Keyword,
            Category = categories[seed.CategoryName],
            CreatedAt = now,
            UserId = userId,
        }));
    }
}
