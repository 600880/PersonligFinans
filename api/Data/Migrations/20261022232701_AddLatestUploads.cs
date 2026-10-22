using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace PersonligFinans.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddLatestUploads : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "latest_uploads",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    user_id = table.Column<string>(type: "text", nullable: false),
                    upload_id = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_latest_uploads", x => x.id);
                    table.ForeignKey(
                        name: "fk_latest_uploads_asp_net_users_user_id",
                        column: x => x.user_id,
                        principalTable: "asp_net_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_latest_uploads_user_id",
                table: "latest_uploads",
                column: "user_id",
                unique: true);

            // Each User's latest Upload was the one of their most recently imported Bank Statement,
            // so their New rules stay New.
            migrationBuilder.Sql("""
                INSERT INTO latest_uploads (user_id, upload_id)
                SELECT DISTINCT ON (user_id) user_id, upload_id
                FROM bank_statements
                ORDER BY user_id, imported_at DESC, id DESC;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "latest_uploads");
        }
    }
}
