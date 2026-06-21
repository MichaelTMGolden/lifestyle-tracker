using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace PersonalDashboard.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddScheduleOverrides : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ScheduleOverrides",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ScheduleBlockId = table.Column<int>(type: "integer", nullable: false),
                    WeekStart = table.Column<DateOnly>(type: "date", nullable: false),
                    Details = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ScheduleOverrides", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ScheduleOverrides_ScheduleBlocks_ScheduleBlockId",
                        column: x => x.ScheduleBlockId,
                        principalTable: "ScheduleBlocks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ScheduleOverrides_ScheduleBlockId_WeekStart",
                table: "ScheduleOverrides",
                columns: new[] { "ScheduleBlockId", "WeekStart" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ScheduleOverrides");
        }
    }
}
