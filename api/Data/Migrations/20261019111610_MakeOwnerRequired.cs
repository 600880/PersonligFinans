using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PersonligFinans.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class MakeOwnerRequired : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // The rows from before Users were given to their owner by hand. What can still have no
            // owner is the Categories and rules that earlier migrations seeded into every database,
            // left behind by AddUserToOwnedRows, so they go: each User has copies of their own. An
            // unowned Transaction or Bank Statement, which is real data, still makes this fail
            // without a default, and the migration's transaction then undoes the deletions too.
            migrationBuilder.Sql(
                """
                DELETE FROM categorization_rules WHERE user_id IS NULL;
                DELETE FROM categories WHERE user_id IS NULL;
                """);

            migrationBuilder.AlterColumn<string>(
                name: "user_id",
                table: "transactions",
                type: "text",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "user_id",
                table: "categorization_rules",
                type: "text",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "user_id",
                table: "categories",
                type: "text",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "user_id",
                table: "bank_statements",
                type: "text",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // The deleted seeds aren't brought back: no User saw them.
            migrationBuilder.AlterColumn<string>(
                name: "user_id",
                table: "transactions",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "text");

            migrationBuilder.AlterColumn<string>(
                name: "user_id",
                table: "categorization_rules",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "text");

            migrationBuilder.AlterColumn<string>(
                name: "user_id",
                table: "categories",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "text");

            migrationBuilder.AlterColumn<string>(
                name: "user_id",
                table: "bank_statements",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "text");
        }
    }
}
