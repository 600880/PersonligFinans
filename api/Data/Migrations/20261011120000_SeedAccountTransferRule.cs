using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PersonligFinans.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class SeedAccountTransferRule : Migration
    {
        // Spelled out rather than taken from DescriptionCleaner and SeedCategories, because a
        // migration must keep meaning the same thing whatever the code later does.
        private const int Transfers = 12;
        private const string Prefix = "Overføring til konto";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Imported payments to a bare account number were stored as just the number; give them the
            // prefix DescriptionCleaner now adds. The rule is a plain insert, like the other seeded
            // rules, and a keyword the user already has a rule for keeps the user's rule. The next
            // startup re-matches the rewritten Transactions against it.
            migrationBuilder.Sql(
                $$"""
                UPDATE transactions SET description = '{{Prefix}} ' || description
                WHERE bank_statement_id IS NOT NULL AND description ~ '^\d{4}\.\d{2}\.\d{5}$';
                INSERT INTO categorization_rules (keyword, category_id, created_at) VALUES
                ('{{Prefix.ToLowerInvariant()}}', {{Transfers}}, now())
                ON CONFLICT ((lower(keyword))) DO NOTHING;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // As in SeedCategorizationRules, Transactions categorized by the rule go back to
            // Uncategorized, and the next startup re-matches them against the remaining rules.
            migrationBuilder.Sql(
                $$"""
                UPDATE transactions SET category_id = NULL
                WHERE categorization_rule_id IN (SELECT id FROM categorization_rules WHERE keyword = '{{Prefix.ToLowerInvariant()}}');
                DELETE FROM categorization_rules WHERE keyword = '{{Prefix.ToLowerInvariant()}}';
                UPDATE transactions SET description = substr(description, {{Prefix.Length + 2}})
                WHERE bank_statement_id IS NOT NULL AND description ~ '^{{Prefix}} \d{4}\.\d{2}\.\d{5}$';
                """);
        }
    }
}
