using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PersonalDashboard.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddHabitColor : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ColorHex",
                table: "Habits",
                type: "character varying(7)",
                maxLength: 7,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ColorHex",
                table: "Habits");
        }
    }
}
