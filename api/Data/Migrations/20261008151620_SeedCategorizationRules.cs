using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PersonligFinans.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class SeedCategorizationRules : Migration
    {
        // Category ids as seeded by InitialCreate. Spelled out here, because a migration must keep
        // meaning the same thing whatever the code later does with its seed lists.
        private const int Groceries = 1;
        private const int Restaurants = 2;
        private const int Transport = 3;
        private const int Utilities = 5;
        private const int Subscriptions = 6;
        private const int Health = 7;
        private const int Shopping = 8;
        private const int Entertainment = 9;
        private const int Travel = 10;
        private const int Transfers = 12;

        // Plain inserts rather than HasData: seeded rules are ordinary rules the user may edit or
        // delete, so the model must not own them, or a later migration would restore them.
        private static readonly (string Keyword, int CategoryId)[] Seeds =
        [
            ("rema", Groceries), ("kiwi", Groceries), ("coop", Groceries), ("meny", Groceries),
            ("joker", Groceries), ("bunnpris", Groceries),
            ("mcdonald", Restaurants), ("burger king", Restaurants), ("peppes", Restaurants),
            ("espresso house", Restaurants), ("starbucks", Restaurants), ("foodora", Restaurants),
            ("wolt", Restaurants),
            ("vy", Transport), ("skyss", Transport), ("ruter", Transport), ("flytoget", Transport),
            ("circle k", Transport), ("uno-x", Transport), ("easypark", Transport),
            ("fjordkraft", Utilities), ("tibber", Utilities), ("telenor", Utilities), ("telia", Utilities),
            ("netflix", Subscriptions), ("spotify", Subscriptions), ("viaplay", Subscriptions),
            ("hbo", Subscriptions), ("disney", Subscriptions),
            ("apotek", Health),
            ("elkjøp", Shopping), ("clas ohlson", Shopping), ("ikea", Shopping), ("xxl", Shopping),
            ("zalando", Shopping), ("komplett", Shopping),
            ("kino", Entertainment),
            ("norwegian air", Travel), ("widerøe", Travel), ("airbnb", Travel), ("booking.com", Travel),
            ("overføring mellom egne kontoer", Transfers),
        ];

        private static string SqlString(string value) => $"'{value.Replace("'", "''")}'";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // A keyword the user already has a rule for keeps the user's rule. Imported Transactions
            // already stored are re-matched against the new rules on the next startup.
            var rows = string.Join(",\n", Seeds.Select(s => $"({SqlString(s.Keyword)}, {s.CategoryId}, now())"));
            migrationBuilder.Sql(
                $"""
                INSERT INTO categorization_rules (keyword, category_id, created_at) VALUES
                {rows}
                ON CONFLICT ((lower(keyword))) DO NOTHING;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Transactions categorized by a seeded rule go back to Uncategorized rather than keeping
            // its Category without the rule, which would look like a manual choice; the next startup
            // re-matches them against the remaining rules. Known limit, as this only runs by hand: a
            // rule the user had with a seeded keyword before Up is removed too.
            var keywords = string.Join(", ", Seeds.Select(s => SqlString(s.Keyword)));
            migrationBuilder.Sql(
                $"""
                UPDATE transactions SET category_id = NULL
                WHERE categorization_rule_id IN (SELECT id FROM categorization_rules WHERE keyword IN ({keywords}));
                DELETE FROM categorization_rules WHERE keyword IN ({keywords});
                """);
        }
    }
}
