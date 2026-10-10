using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PersonligFinans.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddDescriptionAndBuiltInToCategories : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Names become unique ignoring case, as keywords are; EF Core can't model an expression index.
            migrationBuilder.DropIndex(
                name: "ix_categories_name",
                table: "categories");

            migrationBuilder.Sql(
                "CREATE UNIQUE INDEX ix_categories_lower_name ON categories (lower(name));");

            migrationBuilder.AddColumn<bool>(
                name: "built_in",
                table: "categories",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "description",
                table: "categories",
                type: "character varying(200)",
                maxLength: 200,
                nullable: false,
                defaultValue: "");

            migrationBuilder.UpdateData(
                table: "categories",
                keyColumn: "id",
                keyValue: 1,
                columns: new[] { "built_in", "description" },
                values: new object[] { true, "All groceries." });

            migrationBuilder.UpdateData(
                table: "categories",
                keyColumn: "id",
                keyValue: 2,
                columns: new[] { "built_in", "description" },
                values: new object[] { false, "Restaurant, takeaway, bakery etc." });

            migrationBuilder.UpdateData(
                table: "categories",
                keyColumn: "id",
                keyValue: 3,
                columns: new[] { "built_in", "description" },
                values: new object[] { true, "All transport." });

            migrationBuilder.UpdateData(
                table: "categories",
                keyColumn: "id",
                keyValue: 4,
                columns: new[] { "built_in", "description" },
                values: new object[] { true, "Mortgage, common costs and insurance." });

            migrationBuilder.UpdateData(
                table: "categories",
                keyColumn: "id",
                keyValue: 5,
                columns: new[] { "built_in", "description" },
                values: new object[] { false, "Electricity, water, phone, internet etc." });

            migrationBuilder.UpdateData(
                table: "categories",
                keyColumn: "id",
                keyValue: 6,
                columns: new[] { "built_in", "description" },
                values: new object[] { false, "All subscriptions." });

            migrationBuilder.UpdateData(
                table: "categories",
                keyColumn: "id",
                keyValue: 7,
                columns: new[] { "built_in", "description" },
                values: new object[] { false, "Pharmacy etc." });

            migrationBuilder.UpdateData(
                table: "categories",
                keyColumn: "id",
                keyValue: 8,
                columns: new[] { "built_in", "description" },
                values: new object[] { false, "All shopping." });

            migrationBuilder.UpdateData(
                table: "categories",
                keyColumn: "id",
                keyValue: 9,
                columns: new[] { "built_in", "description" },
                values: new object[] { false, "Movies, video games etc." });

            migrationBuilder.UpdateData(
                table: "categories",
                keyColumn: "id",
                keyValue: 10,
                columns: new[] { "built_in", "description" },
                values: new object[] { false, "All travel." });

            migrationBuilder.UpdateData(
                table: "categories",
                keyColumn: "id",
                keyValue: 11,
                columns: new[] { "built_in", "description" },
                values: new object[] { true, "All income." });

            migrationBuilder.UpdateData(
                table: "categories",
                keyColumn: "id",
                keyValue: 12,
                columns: new[] { "built_in", "description" },
                values: new object[] { true, "All private transfers." });

            migrationBuilder.UpdateData(
                table: "categories",
                keyColumn: "id",
                keyValue: 13,
                columns: new[] { "built_in", "description" },
                values: new object[] { true, "Costs that don't belong in any other category." });

            migrationBuilder.UpdateData(
                table: "categories",
                keyColumn: "id",
                keyValue: 14,
                columns: new[] { "built_in", "description" },
                values: new object[] { true, "All clothing." });

            migrationBuilder.UpdateData(
                table: "categories",
                keyColumn: "id",
                keyValue: 15,
                columns: new[] { "built_in", "description" },
                values: new object[] { false, "All electronics." });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP INDEX ix_categories_lower_name;");

            migrationBuilder.DropColumn(
                name: "built_in",
                table: "categories");

            migrationBuilder.DropColumn(
                name: "description",
                table: "categories");

            migrationBuilder.CreateIndex(
                name: "ix_categories_name",
                table: "categories",
                column: "name",
                unique: true);
        }
    }
}
