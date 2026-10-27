namespace PersonligFinans.Api.Categories;

// The colours Categories are drawn in on the Dashboard. A new Category gets the first palette colour
// no Category uses yet, so it can be told apart from the others; once all are used, the fallback.
// Any Category can then be given any palette colour, even one another Category has, but never the
// fallback or Uncategorized's grey.
public static class CategoryColours
{
    // The first 15 are the seeded Categories' colours, in the order they are seeded.
    public static readonly string[] Palette =
    [
        "#2a78d6",
        "#eb6834",
        "#1baf7a",
        "#eda100",
        "#e87ba4",
        "#008300",
        "#4a3aa7",
        "#e34948",
        "#104281",
        "#86b6ef",
        "#8a5a1c",
        "#0f766e",
        "#9085e9",
        "#b8336a",
        "#6b8e23",
        "#0891b2",
        "#7c3aed",
        "#c026d3",
        "#84cc16",
        "#f4a582",
        "#164e63",
    ];

    // Slate, for a Category added once the palette is used up.
    public const string Fallback = "#475569";

    // The client's neutral grey for Uncategorized, which no Category ever gets.
    public const string Uncategorized = "#94a3b8";

    // The colour for a new Category, given the colours the Categories already have.
    public static string Next(IEnumerable<string> used)
    {
        var taken = used.ToHashSet(StringComparer.OrdinalIgnoreCase);
        return Palette.FirstOrDefault(c => !taken.Contains(c)) ?? Fallback;
    }
}
