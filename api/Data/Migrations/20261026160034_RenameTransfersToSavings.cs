using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PersonligFinans.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class RenameTransfersToSavings : Migration
    {
        // Spelled out rather than taken from Seeds, because a migration must keep meaning the same
        // thing whatever the code later does.
        private const string OldName = "Transfers";
        private const string OldDescription = "All bank transfers.";
        private const string NewName = "Savings";
        private const string NewDescription = "Money moved between own accounts.";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Every User's Built-in Transfers Category becomes Savings, its description replaced
            // whether or not the User re-described it.
            migrationBuilder.Sql(
                $"""
                UPDATE categories SET name = '{NewName}', description = '{NewDescription}'
                WHERE built_in AND name = '{OldName}';
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                $"""
                UPDATE categories SET name = '{OldName}', description = '{OldDescription}'
                WHERE built_in AND name = '{NewName}';
                """);
        }
    }
}
