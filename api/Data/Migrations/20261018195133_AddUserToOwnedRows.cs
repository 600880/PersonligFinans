using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace PersonligFinans.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddUserToOwnedRows : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Every row already stored keeps a null owner, so it belongs to nobody and no User sees it.
            // That includes the Categories that InitialCreate and later migrations seeded: the model
            // no longer owns them as seed data, but they are kept rather than deleted, since
            // Transactions and rules refer to them. Each User gets copies of the seeds of their own.
            migrationBuilder.DropIndex(
                name: "ix_bank_statements_account_number_period_start_period_end",
                table: "bank_statements");

            migrationBuilder.AddColumn<string>(
                name: "user_id",
                table: "transactions",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "user_id",
                table: "categorization_rules",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "user_id",
                table: "categories",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "user_id",
                table: "bank_statements",
                type: "text",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_transactions_user_id",
                table: "transactions",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_categorization_rules_user_id",
                table: "categorization_rules",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_categories_user_id",
                table: "categories",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_bank_statements_user_id_account_number_period_start_period_",
                table: "bank_statements",
                columns: new[] { "user_id", "account_number", "period_start", "period_end" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "fk_bank_statements_asp_net_users_user_id",
                table: "bank_statements",
                column: "user_id",
                principalTable: "asp_net_users",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "fk_categories_asp_net_users_user_id",
                table: "categories",
                column: "user_id",
                principalTable: "asp_net_users",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "fk_categorization_rules_asp_net_users_user_id",
                table: "categorization_rules",
                column: "user_id",
                principalTable: "asp_net_users",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "fk_transactions_asp_net_users_user_id",
                table: "transactions",
                column: "user_id",
                principalTable: "asp_net_users",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);

            // Names and keywords become unique within each User, through hand-made indexes as before,
            // since EF Core can't model an expression index. Postgres never counts two nulls as equal,
            // so rows with no owner never clash with a User's.
            migrationBuilder.Sql(
                """
                DROP INDEX ix_categories_lower_name;
                CREATE UNIQUE INDEX ix_categories_user_id_lower_name ON categories (user_id, lower(name));
                DROP INDEX ix_categorization_rules_lower_keyword;
                CREATE UNIQUE INDEX ix_categorization_rules_user_id_lower_keyword ON categorization_rules (user_id, lower(keyword));
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Fails if two Users have Categories of the same name, rules of the same keyword or the
            // same Bank Statement, which can't all be kept once these are unique across everyone.
            migrationBuilder.Sql(
                """
                DROP INDEX ix_categories_user_id_lower_name;
                CREATE UNIQUE INDEX ix_categories_lower_name ON categories (lower(name));
                DROP INDEX ix_categorization_rules_user_id_lower_keyword;
                CREATE UNIQUE INDEX ix_categorization_rules_lower_keyword ON categorization_rules (lower(keyword));
                """);

            migrationBuilder.DropForeignKey(
                name: "fk_bank_statements_asp_net_users_user_id",
                table: "bank_statements");

            migrationBuilder.DropForeignKey(
                name: "fk_categories_asp_net_users_user_id",
                table: "categories");

            migrationBuilder.DropForeignKey(
                name: "fk_categorization_rules_asp_net_users_user_id",
                table: "categorization_rules");

            migrationBuilder.DropForeignKey(
                name: "fk_transactions_asp_net_users_user_id",
                table: "transactions");

            migrationBuilder.DropIndex(
                name: "ix_transactions_user_id",
                table: "transactions");

            migrationBuilder.DropIndex(
                name: "ix_categorization_rules_user_id",
                table: "categorization_rules");

            migrationBuilder.DropIndex(
                name: "ix_categories_user_id",
                table: "categories");

            migrationBuilder.DropIndex(
                name: "ix_bank_statements_user_id_account_number_period_start_period_",
                table: "bank_statements");

            migrationBuilder.DropColumn(
                name: "user_id",
                table: "transactions");

            migrationBuilder.DropColumn(
                name: "user_id",
                table: "categorization_rules");

            migrationBuilder.DropColumn(
                name: "user_id",
                table: "categories");

            migrationBuilder.DropColumn(
                name: "user_id",
                table: "bank_statements");

            migrationBuilder.CreateIndex(
                name: "ix_bank_statements_account_number_period_start_period_end",
                table: "bank_statements",
                columns: new[] { "account_number", "period_start", "period_end" },
                unique: true);
        }
    }
}
