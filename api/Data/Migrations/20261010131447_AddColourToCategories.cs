using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PersonligFinans.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddColourToCategories : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // The seeded Categories get the colours the client used to hard-code for them, so they
            // look unchanged. Any other Category gets the fallback slate.
            migrationBuilder.AddColumn<string>(
                name: "colour",
                table: "categories",
                type: "character varying(7)",
                maxLength: 7,
                nullable: false,
                defaultValue: "#475569");

            migrationBuilder.UpdateData(
                table: "categories",
                keyColumn: "id",
                keyValue: 1,
                column: "colour",
                value: "#2a78d6");

            migrationBuilder.UpdateData(
                table: "categories",
                keyColumn: "id",
                keyValue: 2,
                column: "colour",
                value: "#eb6834");

            migrationBuilder.UpdateData(
                table: "categories",
                keyColumn: "id",
                keyValue: 3,
                column: "colour",
                value: "#1baf7a");

            migrationBuilder.UpdateData(
                table: "categories",
                keyColumn: "id",
                keyValue: 4,
                column: "colour",
                value: "#eda100");

            migrationBuilder.UpdateData(
                table: "categories",
                keyColumn: "id",
                keyValue: 5,
                column: "colour",
                value: "#e87ba4");

            migrationBuilder.UpdateData(
                table: "categories",
                keyColumn: "id",
                keyValue: 6,
                column: "colour",
                value: "#008300");

            migrationBuilder.UpdateData(
                table: "categories",
                keyColumn: "id",
                keyValue: 7,
                column: "colour",
                value: "#4a3aa7");

            migrationBuilder.UpdateData(
                table: "categories",
                keyColumn: "id",
                keyValue: 8,
                column: "colour",
                value: "#e34948");

            migrationBuilder.UpdateData(
                table: "categories",
                keyColumn: "id",
                keyValue: 9,
                column: "colour",
                value: "#104281");

            migrationBuilder.UpdateData(
                table: "categories",
                keyColumn: "id",
                keyValue: 10,
                column: "colour",
                value: "#86b6ef");

            migrationBuilder.UpdateData(
                table: "categories",
                keyColumn: "id",
                keyValue: 11,
                column: "colour",
                value: "#8a5a1c");

            migrationBuilder.UpdateData(
                table: "categories",
                keyColumn: "id",
                keyValue: 12,
                column: "colour",
                value: "#0f766e");

            migrationBuilder.UpdateData(
                table: "categories",
                keyColumn: "id",
                keyValue: 13,
                column: "colour",
                value: "#9085e9");

            migrationBuilder.UpdateData(
                table: "categories",
                keyColumn: "id",
                keyValue: 14,
                column: "colour",
                value: "#b8336a");

            migrationBuilder.UpdateData(
                table: "categories",
                keyColumn: "id",
                keyValue: 15,
                column: "colour",
                value: "#6b8e23");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "colour",
                table: "categories");
        }
    }
}
