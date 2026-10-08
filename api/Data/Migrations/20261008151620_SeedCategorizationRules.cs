using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PersonligFinans.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class SeedCategorizationRules : Migration
    {
        // Plain inserts rather than HasData: seeded rules are ordinary rules the user may edit or
        // delete, so the model must not own them, or a later migration would restore them.
        private static readonly (string Keyword, int CategoryId)[] Seeds =
        [
            ("rema", 1), ("kiwi", 1), ("coop", 1), ("meny", 1), ("joker", 1), ("bunnpris", 1),
            ("mcdonald", 2), ("burger king", 2), ("peppes", 2), ("espresso house", 2), ("starbucks", 2),
            ("foodora", 2), ("wolt", 2),
            ("vy", 3), ("skyss", 3), ("ruter", 3), ("flytoget", 3), ("circle k", 3), ("uno-x", 3), ("easypark", 3),
            ("fjordkraft", 5), ("tibber", 5), ("telenor", 5), ("telia", 5),
            ("netflix", 6), ("spotify", 6), ("viaplay", 6), ("hbo", 6), ("disney", 6),
            ("apotek", 7),
            ("elkjøp", 8), ("clas ohlson", 8), ("ikea", 8), ("xxl", 8), ("zalando", 8), ("komplett", 8),
            ("kino", 9),
            ("norwegian air", 10), ("widerøe", 10), ("airbnb", 10), ("booking.com", 10),
            ("overføring mellom egne kontoer", 12),
        ];

        private static string SeededKeywords => string.Join(", ", Seeds.Select(s => $"'{s.Keyword}'"));

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // A keyword the user already has a rule for keeps the user's rule.
            var values = string.Join(",\n", Seeds.Select(s => $"('{s.Keyword}', {s.CategoryId}, now())"));
            migrationBuilder.Sql(
                $"""
                INSERT INTO categorization_rules (keyword, category_id, created_at) VALUES
                {values}
                ON CONFLICT ((lower(keyword))) DO NOTHING;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Transactions categorized by a seeded rule go back to Uncategorized rather than keeping
            // its Category without the rule, which would look like a manual choice.
            migrationBuilder.Sql(
                $"""
                UPDATE transactions SET category_id = NULL
                WHERE categorization_rule_id IN (SELECT id FROM categorization_rules WHERE keyword IN ({SeededKeywords}));
                DELETE FROM categorization_rules WHERE keyword IN ({SeededKeywords});
                """);
        }
    }
}
