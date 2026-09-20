using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace PersonalDashboard.Api.Migrations
{
    /// <inheritdoc />
    public partial class DashboardPlanningAndProgress : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "IsPriority",
                table: "TodoItems",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateOnly>(
                name: "PlannedFor",
                table: "TodoItems",
                type: "date",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "DashboardSettings",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false),
                    CaloriesTarget = table.Column<int>(type: "integer", nullable: false),
                    ProteinGTarget = table.Column<int>(type: "integer", nullable: false),
                    CarbsGTarget = table.Column<int>(type: "integer", nullable: false),
                    FatGTarget = table.Column<int>(type: "integer", nullable: false),
                    StepsTarget = table.Column<int>(type: "integer", nullable: false),
                    SleepMinutesTarget = table.Column<int>(type: "integer", nullable: false),
                    SleepScoreTarget = table.Column<int>(type: "integer", nullable: false),
                    RestingHrBaseline = table.Column<int>(type: "integer", nullable: false),
                    RestingCaloriesEstimate = table.Column<int>(type: "integer", nullable: false),
                    ArtistMonthlyListenersTarget = table.Column<int>(type: "integer", nullable: false),
                    ArtistFollowersTarget = table.Column<int>(type: "integer", nullable: false),
                    ArtistTotalStreamsTarget = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DashboardSettings", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "SkillBenchmarks",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    HabitId = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    Rubric = table.Column<string>(type: "text", nullable: false),
                    Archived = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SkillBenchmarks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SkillBenchmarks_Habits_HabitId",
                        column: x => x.HabitId,
                        principalTable: "Habits",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "SkillAssessments",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    SkillBenchmarkId = table.Column<int>(type: "integer", nullable: false),
                    AssessedOn = table.Column<DateOnly>(type: "date", nullable: false),
                    Score = table.Column<double>(type: "double precision", nullable: false),
                    EvidenceUrl = table.Column<string>(type: "text", nullable: true),
                    Notes = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SkillAssessments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SkillAssessments_SkillBenchmarks_SkillBenchmarkId",
                        column: x => x.SkillBenchmarkId,
                        principalTable: "SkillBenchmarks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_TodoItems_PlannedFor_IsPriority",
                table: "TodoItems",
                columns: new[] { "PlannedFor", "IsPriority" });

            migrationBuilder.CreateIndex(
                name: "IX_SkillAssessments_SkillBenchmarkId_AssessedOn",
                table: "SkillAssessments",
                columns: new[] { "SkillBenchmarkId", "AssessedOn" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SkillBenchmarks_HabitId",
                table: "SkillBenchmarks",
                column: "HabitId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "DashboardSettings");

            migrationBuilder.DropTable(
                name: "SkillAssessments");

            migrationBuilder.DropTable(
                name: "SkillBenchmarks");

            migrationBuilder.DropIndex(
                name: "IX_TodoItems_PlannedFor_IsPriority",
                table: "TodoItems");

            migrationBuilder.DropColumn(
                name: "IsPriority",
                table: "TodoItems");

            migrationBuilder.DropColumn(
                name: "PlannedFor",
                table: "TodoItems");
        }
    }
}
