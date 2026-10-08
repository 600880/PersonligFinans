using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace PersonligFinans.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddCategorizationRules : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "categorization_rule_id",
                table: "transactions",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "categorization_rules",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    keyword = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    category_id = table.Column<int>(type: "integer", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_categorization_rules", x => x.id);
                    table.ForeignKey(
                        name: "fk_categorization_rules_categories_category_id",
                        column: x => x.category_id,
                        principalTable: "categories",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_transactions_categorization_rule_id",
                table: "transactions",
                column: "categorization_rule_id");

            migrationBuilder.CreateIndex(
                name: "ix_categorization_rules_category_id",
                table: "categorization_rules",
                column: "category_id");

            // Keywords are unique ignoring case; EF Core can't model an expression index.
            migrationBuilder.Sql(
                "CREATE UNIQUE INDEX ix_categorization_rules_lower_keyword ON categorization_rules (lower(keyword));");

            migrationBuilder.AddForeignKey(
                name: "fk_transactions_categorization_rules_categorization_rule_id",
                table: "transactions",
                column: "categorization_rule_id",
                principalTable: "categorization_rules",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "fk_transactions_categorization_rules_categorization_rule_id",
                table: "transactions");

            migrationBuilder.DropTable(
                name: "categorization_rules");

            migrationBuilder.DropIndex(
                name: "ix_transactions_categorization_rule_id",
                table: "transactions");

            migrationBuilder.DropColumn(
                name: "categorization_rule_id",
                table: "transactions");
        }
    }
}
