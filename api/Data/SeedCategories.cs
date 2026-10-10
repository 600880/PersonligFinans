namespace PersonligFinans.Api.Data;

public static class SeedCategories
{
    public static readonly Category[] All =
    [
        new() { Id = 1, Name = "Groceries", Description = "All groceries.", BuiltIn = true },
        new() { Id = 2, Name = "Restaurants", Description = "Restaurant, takeaway, bakery etc." },
        new() { Id = 3, Name = "Transport", Description = "All transport.", BuiltIn = true },
        new() { Id = 4, Name = "Housing", Description = "Mortgage, common costs and insurance.", BuiltIn = true },
        new() { Id = 5, Name = "Utilities", Description = "Electricity, water, phone, internet etc." },
        new() { Id = 6, Name = "Subscriptions", Description = "All subscriptions." },
        new() { Id = 7, Name = "Health", Description = "Pharmacy etc." },
        new() { Id = 8, Name = "Shopping", Description = "All shopping." },
        new() { Id = 9, Name = "Entertainment", Description = "Movies, video games etc." },
        new() { Id = 10, Name = "Travel", Description = "All travel." },
        new() { Id = 11, Name = "Income", Description = "All income.", BuiltIn = true },
        new() { Id = 12, Name = "Transfers", Description = "All private transfers.", BuiltIn = true },
        new() { Id = 13, Name = "Other", Description = "Costs that don't belong in any other category.", BuiltIn = true },
        new() { Id = 14, Name = "Clothing", Description = "All clothing.", BuiltIn = true },
        new() { Id = 15, Name = "Electronics", Description = "All electronics." },
    ];
}
