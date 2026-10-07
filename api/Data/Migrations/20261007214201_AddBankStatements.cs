using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace PersonligFinans.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddBankStatements : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "bank_statement_id",
                table: "transactions",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "bank_statements",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    account_number = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    period_start = table.Column<DateOnly>(type: "date", nullable: false),
                    period_end = table.Column<DateOnly>(type: "date", nullable: false),
                    opening_balance = table.Column<decimal>(type: "numeric(12,2)", precision: 12, scale: 2, nullable: false),
                    closing_balance = table.Column<decimal>(type: "numeric(12,2)", precision: 12, scale: 2, nullable: false),
                    imported_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_bank_statements", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_transactions_bank_statement_id",
                table: "transactions",
                column: "bank_statement_id");

            migrationBuilder.CreateIndex(
                name: "ix_bank_statements_account_number_period_start_period_end",
                table: "bank_statements",
                columns: new[] { "account_number", "period_start", "period_end" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "fk_transactions_bank_statements_bank_statement_id",
                table: "transactions",
                column: "bank_statement_id",
                principalTable: "bank_statements",
                principalColumn: "id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "fk_transactions_bank_statements_bank_statement_id",
                table: "transactions");

            migrationBuilder.DropTable(
                name: "bank_statements");

            migrationBuilder.DropIndex(
                name: "ix_transactions_bank_statement_id",
                table: "transactions");

            migrationBuilder.DropColumn(
                name: "bank_statement_id",
                table: "transactions");
        }
    }
}
