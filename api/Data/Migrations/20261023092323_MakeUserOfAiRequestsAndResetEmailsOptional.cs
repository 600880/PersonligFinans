using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PersonligFinans.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class MakeUserOfAiRequestsAndResetEmailsOptional : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "fk_ai_requests_asp_net_users_user_id",
                table: "ai_requests");

            migrationBuilder.DropForeignKey(
                name: "fk_sent_password_reset_emails_asp_net_users_user_id",
                table: "sent_password_reset_emails");

            migrationBuilder.AlterColumn<string>(
                name: "user_id",
                table: "sent_password_reset_emails",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "text");

            migrationBuilder.AlterColumn<string>(
                name: "user_id",
                table: "ai_requests",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "text");

            migrationBuilder.AddForeignKey(
                name: "fk_ai_requests_asp_net_users_user_id",
                table: "ai_requests",
                column: "user_id",
                principalTable: "asp_net_users",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "fk_sent_password_reset_emails_asp_net_users_user_id",
                table: "sent_password_reset_emails",
                column: "user_id",
                principalTable: "asp_net_users",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "fk_ai_requests_asp_net_users_user_id",
                table: "ai_requests");

            migrationBuilder.DropForeignKey(
                name: "fk_sent_password_reset_emails_asp_net_users_user_id",
                table: "sent_password_reset_emails");

            // Before this migration a deleted User's AI requests and reset emails went with it, so
            // those kept with no User since go now.
            migrationBuilder.Sql(
                """
                DELETE FROM sent_password_reset_emails WHERE user_id IS NULL;
                DELETE FROM ai_requests WHERE user_id IS NULL;
                """);

            migrationBuilder.AlterColumn<string>(
                name: "user_id",
                table: "sent_password_reset_emails",
                type: "text",
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "user_id",
                table: "ai_requests",
                type: "text",
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);

            migrationBuilder.AddForeignKey(
                name: "fk_ai_requests_asp_net_users_user_id",
                table: "ai_requests",
                column: "user_id",
                principalTable: "asp_net_users",
                principalColumn: "id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "fk_sent_password_reset_emails_asp_net_users_user_id",
                table: "sent_password_reset_emails",
                column: "user_id",
                principalTable: "asp_net_users",
                principalColumn: "id",
                onDelete: ReferentialAction.Cascade);
        }
    }
}
