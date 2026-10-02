namespace PersonligFinans.Api.Data;

public static class SeedCategories
{
    public static readonly Category[] All =
    [
        new() { Id = 1, Name = "Groceries" },
        new() { Id = 2, Name = "Restaurants" },
        new() { Id = 3, Name = "Transport" },
        new() { Id = 4, Name = "Housing" },
        new() { Id = 5, Name = "Utilities" },
        new() { Id = 6, Name = "Subscriptions" },
        new() { Id = 7, Name = "Health" },
        new() { Id = 8, Name = "Shopping" },
        new() { Id = 9, Name = "Entertainment" },
        new() { Id = 10, Name = "Travel" },
        new() { Id = 11, Name = "Income" },
        new() { Id = 12, Name = "Transfers" },
        new() { Id = 13, Name = "Other" },
    ];
}
