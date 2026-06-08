using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PersonalDashboard.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddFoodMicronutrients : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<double>(
                name: "CalciumMg",
                table: "FoodEntries",
                type: "double precision",
                nullable: false,
                defaultValue: 0.0);

            migrationBuilder.AddColumn<double>(
                name: "FiberG",
                table: "FoodEntries",
                type: "double precision",
                nullable: false,
                defaultValue: 0.0);

            migrationBuilder.AddColumn<double>(
                name: "IronMg",
                table: "FoodEntries",
                type: "double precision",
                nullable: false,
                defaultValue: 0.0);

            migrationBuilder.AddColumn<double>(
                name: "PotassiumMg",
                table: "FoodEntries",
                type: "double precision",
                nullable: false,
                defaultValue: 0.0);

            migrationBuilder.AddColumn<double>(
                name: "SatFatG",
                table: "FoodEntries",
                type: "double precision",
                nullable: false,
                defaultValue: 0.0);

            migrationBuilder.AddColumn<double>(
                name: "SodiumMg",
                table: "FoodEntries",
                type: "double precision",
                nullable: false,
                defaultValue: 0.0);

            migrationBuilder.AddColumn<double>(
                name: "SugarG",
                table: "FoodEntries",
                type: "double precision",
                nullable: false,
                defaultValue: 0.0);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CalciumMg",
                table: "FoodEntries");

            migrationBuilder.DropColumn(
                name: "FiberG",
                table: "FoodEntries");

            migrationBuilder.DropColumn(
                name: "IronMg",
                table: "FoodEntries");

            migrationBuilder.DropColumn(
                name: "PotassiumMg",
                table: "FoodEntries");

            migrationBuilder.DropColumn(
                name: "SatFatG",
                table: "FoodEntries");

            migrationBuilder.DropColumn(
                name: "SodiumMg",
                table: "FoodEntries");

            migrationBuilder.DropColumn(
                name: "SugarG",
                table: "FoodEntries");
        }
    }
}
