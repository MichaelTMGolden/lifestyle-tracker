using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace PersonalDashboard.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddWorkoutDetail : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Workouts_DataSourceId",
                table: "Workouts");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "EndedAt",
                table: "Workouts",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ExternalId",
                table: "Workouts",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Title",
                table: "Workouts",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "WorkoutSets",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    WorkoutId = table.Column<long>(type: "bigint", nullable: false),
                    ExerciseIndex = table.Column<int>(type: "integer", nullable: false),
                    Exercise = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    ExerciseTemplateId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    SetIndex = table.Column<int>(type: "integer", nullable: false),
                    Kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    WeightKg = table.Column<double>(type: "double precision", nullable: true),
                    Reps = table.Column<int>(type: "integer", nullable: true),
                    DistanceMeters = table.Column<double>(type: "double precision", nullable: true),
                    DurationSeconds = table.Column<int>(type: "integer", nullable: true),
                    Rpe = table.Column<double>(type: "double precision", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WorkoutSets", x => x.Id);
                    table.ForeignKey(
                        name: "FK_WorkoutSets_Workouts_WorkoutId",
                        column: x => x.WorkoutId,
                        principalTable: "Workouts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Workouts_DataSourceId_ExternalId",
                table: "Workouts",
                columns: new[] { "DataSourceId", "ExternalId" },
                unique: true,
                filter: "\"ExternalId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_WorkoutSets_WorkoutId",
                table: "WorkoutSets",
                column: "WorkoutId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "WorkoutSets");

            migrationBuilder.DropIndex(
                name: "IX_Workouts_DataSourceId_ExternalId",
                table: "Workouts");

            migrationBuilder.DropColumn(
                name: "EndedAt",
                table: "Workouts");

            migrationBuilder.DropColumn(
                name: "ExternalId",
                table: "Workouts");

            migrationBuilder.DropColumn(
                name: "Title",
                table: "Workouts");

            migrationBuilder.CreateIndex(
                name: "IX_Workouts_DataSourceId",
                table: "Workouts",
                column: "DataSourceId");
        }
    }
}
