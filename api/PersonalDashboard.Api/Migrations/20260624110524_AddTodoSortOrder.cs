using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PersonalDashboard.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddTodoSortOrder : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "SortOrder",
                table: "TodoItems",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "SortOrder",
                table: "DailyTodos",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            // Seed the manual order from what the user currently sees, so the lists
            // don't visually jump on first load: tasks by priority then due date,
            // daily to-dos by creation within each day.
            migrationBuilder.Sql(@"
                UPDATE ""TodoItems"" t SET ""SortOrder"" = sub.rn FROM (
                    SELECT ""Id"", ROW_NUMBER() OVER (ORDER BY ""Priority"", ""DueAt"" NULLS LAST, ""Id"") - 1 AS rn
                    FROM ""TodoItems""
                ) sub WHERE t.""Id"" = sub.""Id"";");
            migrationBuilder.Sql(@"
                UPDATE ""DailyTodos"" d SET ""SortOrder"" = sub.rn FROM (
                    SELECT ""Id"", ROW_NUMBER() OVER (PARTITION BY ""Date"" ORDER BY ""CreatedAt"", ""Id"") - 1 AS rn
                    FROM ""DailyTodos""
                ) sub WHERE d.""Id"" = sub.""Id"";");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "SortOrder",
                table: "TodoItems");

            migrationBuilder.DropColumn(
                name: "SortOrder",
                table: "DailyTodos");
        }
    }
}
