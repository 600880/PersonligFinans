using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace PersonligFinans.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddFolders : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "folders",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    user_id = table.Column<string>(type: "text", nullable: false),
                    name = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_folders", x => x.id);
                    table.ForeignKey(
                        name: "fk_folders_asp_net_users_user_id",
                        column: x => x.user_id,
                        principalTable: "asp_net_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_bookmarks_folder_id",
                table: "bookmarks",
                column: "folder_id");

            migrationBuilder.CreateIndex(
                name: "ix_folders_user_id",
                table: "folders",
                column: "user_id");

            // Names are unique within each User ignoring case, as Category names are, through a hand-made
            // index, since EF Core can't model an expression index. Dropping the table drops it too.
            migrationBuilder.Sql(
                "CREATE UNIQUE INDEX ix_folders_user_id_lower_name ON folders (user_id, lower(name));");

            migrationBuilder.AddForeignKey(
                name: "fk_bookmarks_folders_folder_id",
                table: "bookmarks",
                column: "folder_id",
                principalTable: "folders",
                principalColumn: "id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "fk_bookmarks_folders_folder_id",
                table: "bookmarks");

            migrationBuilder.DropTable(
                name: "folders");

            migrationBuilder.DropIndex(
                name: "ix_bookmarks_folder_id",
                table: "bookmarks");
        }
    }
}
