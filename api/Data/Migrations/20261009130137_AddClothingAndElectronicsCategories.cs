using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace PersonligFinans.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddClothingAndElectronicsCategories : Migration
    {
        // Category ids as seeded by InitialCreate and by this migration. Spelled out here, because a
        // migration must keep meaning the same thing whatever the code later does with its seed lists.
        private const int Shopping = 8;
        private const int Clothing = 14;
        private const int Electronics = 15;

        // Seeded rules that SeedCategorizationRules gave Shopping and that now get a Category of their own.
        private static readonly (string Keyword, int CategoryId)[] Moves =
        [
            ("zalando", Clothing),
            ("elkjøp", Electronics), ("komplett", Electronics),
        ];

        // Plain inserts rather than HasData, as in SeedCategorizationRules: seeded rules are ordinary
        // rules the user may edit or delete.
        private static readonly (string Keyword, int CategoryId)[] Seeds =
        [
            ("cubus", Clothing), ("dressmann", Clothing), ("lindex", Clothing), ("bik bok", Clothing),
            ("carlings", Clothing), ("kappahl", Clothing), ("h&m", Clothing),
            ("proshop", Electronics), ("netonnet", Electronics),
        ];

        private static string SqlString(string value) => $"'{value.Replace("'", "''")}'";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.InsertData(
                table: "categories",
                columns: new[] { "id", "name" },
                values: new object[,]
                {
                    { Clothing, "Clothing" },
                    { Electronics, "Electronics" }
                });

            // A rule the user has given another Category keeps it, and a keyword the user already has
            // a rule for keeps the user's rule. Imported Transactions already stored are re-matched
            // against the changed rules on the next startup.
            foreach (var (keyword, categoryId) in Moves)
            {
                migrationBuilder.Sql(
                    $"""
                    UPDATE categorization_rules SET category_id = {categoryId}
                    WHERE lower(keyword) = {SqlString(keyword)} AND category_id = {Shopping};
                    """);
            }

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
            foreach (var (keyword, categoryId) in Moves)
            {
                migrationBuilder.Sql(
                    $"""
                    UPDATE categorization_rules SET category_id = {Shopping}
                    WHERE lower(keyword) = {SqlString(keyword)} AND category_id = {categoryId};
                    """);
            }

            // As in SeedCategorizationRules, Transactions categorized by a removed seeded rule go back
            // to Uncategorized, and the next startup re-matches them against the remaining rules.
            foreach (var (keyword, categoryId) in Seeds)
            {
                var seededRule =
                    $"lower(keyword) = {SqlString(keyword)} AND category_id = {categoryId} AND NOT ai_generated";
                migrationBuilder.Sql(
                    $"""
                    UPDATE transactions SET category_id = NULL
                    WHERE categorization_rule_id IN (SELECT id FROM categorization_rules WHERE {seededRule});
                    DELETE FROM categorization_rules WHERE {seededRule};
                    """);
            }

            // Whatever else still has the Categories, such as the user's own rules and manual choices,
            // falls back to Shopping, which covered them before; otherwise the foreign keys would stop
            // the Categories from being deleted.
            migrationBuilder.Sql(
                $"""
                UPDATE categorization_rules SET category_id = {Shopping} WHERE category_id IN ({Clothing}, {Electronics});
                UPDATE transactions SET category_id = {Shopping} WHERE category_id IN ({Clothing}, {Electronics});
                """);

            migrationBuilder.DeleteData(
                table: "categories",
                keyColumn: "id",
                keyValue: Clothing);

            migrationBuilder.DeleteData(
                table: "categories",
                keyColumn: "id",
                keyValue: Electronics);
        }
    }
}
