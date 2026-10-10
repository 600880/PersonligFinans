namespace PersonligFinans.Api.Data;

public static class SeedCategories
{
    public static readonly Category[] All =
    [
        new() { Id = 1, Name = "Groceries", Description = "All groceries.", Colour = "#2a78d6", BuiltIn = true },
        new() { Id = 2, Name = "Restaurants", Description = "Restaurant, takeaway, bakery etc.", Colour = "#eb6834" },
        new() { Id = 3, Name = "Transport", Description = "All transport.", Colour = "#1baf7a", BuiltIn = true },
        new() { Id = 4, Name = "Housing", Description = "Mortgage, common costs and insurance.", Colour = "#eda100", BuiltIn = true },
        new() { Id = 5, Name = "Utilities", Description = "Electricity, water, phone, internet etc.", Colour = "#e87ba4" },
        new() { Id = 6, Name = "Subscriptions", Description = "All subscriptions.", Colour = "#008300" },
        new() { Id = 7, Name = "Health", Description = "Pharmacy etc.", Colour = "#4a3aa7" },
        new() { Id = 8, Name = "Shopping", Description = "All shopping.", Colour = "#e34948" },
        new() { Id = 9, Name = "Entertainment", Description = "Movies, video games etc.", Colour = "#104281" },
        new() { Id = 10, Name = "Travel", Description = "All travel.", Colour = "#86b6ef" },
        new() { Id = 11, Name = "Income", Description = "All income.", Colour = "#8a5a1c", BuiltIn = true },
        new() { Id = 12, Name = "Transfers", Description = "All private transfers.", Colour = "#0f766e", BuiltIn = true },
        new() { Id = 13, Name = "Other", Description = "Costs that don't belong in any other category.", Colour = "#9085e9", BuiltIn = true },
        new() { Id = 14, Name = "Clothing", Description = "All clothing.", Colour = "#b8336a", BuiltIn = true },
        new() { Id = 15, Name = "Electronics", Description = "All electronics.", Colour = "#6b8e23" },
    ];
}
