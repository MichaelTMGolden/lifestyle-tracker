using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace PersonalDashboard.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddRememberedFoodsAndQuickMeals : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "QuickMeals",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Name = table.Column<string>(type: "text", nullable: false),
                    DefaultMeal = table.Column<int>(type: "integer", nullable: true),
                    UseCount = table.Column<int>(type: "integer", nullable: false),
                    LastUsedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_QuickMeals", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "SavedFoods",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Name = table.Column<string>(type: "text", nullable: false),
                    Brand = table.Column<string>(type: "text", nullable: true),
                    DataSourceId = table.Column<int>(type: "integer", nullable: true),
                    ExternalRef = table.Column<string>(type: "text", nullable: true),
                    ServingDescription = table.Column<string>(type: "text", nullable: true),
                    DefaultQuantity = table.Column<double>(type: "double precision", nullable: false),
                    Grams = table.Column<double>(type: "double precision", nullable: true),
                    Calories = table.Column<double>(type: "double precision", nullable: false),
                    ProteinG = table.Column<double>(type: "double precision", nullable: false),
                    CarbsG = table.Column<double>(type: "double precision", nullable: false),
                    FatG = table.Column<double>(type: "double precision", nullable: false),
                    FiberG = table.Column<double>(type: "double precision", nullable: false),
                    SugarG = table.Column<double>(type: "double precision", nullable: false),
                    SatFatG = table.Column<double>(type: "double precision", nullable: false),
                    SodiumMg = table.Column<double>(type: "double precision", nullable: false),
                    PotassiumMg = table.Column<double>(type: "double precision", nullable: false),
                    CalciumMg = table.Column<double>(type: "double precision", nullable: false),
                    IronMg = table.Column<double>(type: "double precision", nullable: false),
                    Favorite = table.Column<bool>(type: "boolean", nullable: false),
                    UseCount = table.Column<int>(type: "integer", nullable: false),
                    LastUsedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SavedFoods", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "QuickMealItems",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    QuickMealId = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    Brand = table.Column<string>(type: "text", nullable: true),
                    DataSourceId = table.Column<int>(type: "integer", nullable: true),
                    ExternalRef = table.Column<string>(type: "text", nullable: true),
                    ServingDescription = table.Column<string>(type: "text", nullable: true),
                    Quantity = table.Column<double>(type: "double precision", nullable: false),
                    Grams = table.Column<double>(type: "double precision", nullable: true),
                    Calories = table.Column<double>(type: "double precision", nullable: false),
                    ProteinG = table.Column<double>(type: "double precision", nullable: false),
                    CarbsG = table.Column<double>(type: "double precision", nullable: false),
                    FatG = table.Column<double>(type: "double precision", nullable: false),
                    FiberG = table.Column<double>(type: "double precision", nullable: false),
                    SugarG = table.Column<double>(type: "double precision", nullable: false),
                    SatFatG = table.Column<double>(type: "double precision", nullable: false),
                    SodiumMg = table.Column<double>(type: "double precision", nullable: false),
                    PotassiumMg = table.Column<double>(type: "double precision", nullable: false),
                    CalciumMg = table.Column<double>(type: "double precision", nullable: false),
                    IronMg = table.Column<double>(type: "double precision", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_QuickMealItems", x => x.Id);
                    table.ForeignKey(
                        name: "FK_QuickMealItems_QuickMeals_QuickMealId",
                        column: x => x.QuickMealId,
                        principalTable: "QuickMeals",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_QuickMealItems_QuickMealId",
                table: "QuickMealItems",
                column: "QuickMealId");

            migrationBuilder.CreateIndex(
                name: "IX_SavedFoods_Name_Brand_ExternalRef",
                table: "SavedFoods",
                columns: new[] { "Name", "Brand", "ExternalRef" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "QuickMealItems");

            migrationBuilder.DropTable(
                name: "SavedFoods");

            migrationBuilder.DropTable(
                name: "QuickMeals");
        }
    }
}
