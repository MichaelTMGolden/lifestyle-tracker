using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PersonalDashboard.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddMetricSampleUniqueIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_MetricSamples_DataSourceId",
                table: "MetricSamples");

            migrationBuilder.CreateIndex(
                name: "IX_MetricSamples_DataSourceId_MetricKey_RecordedAt",
                table: "MetricSamples",
                columns: new[] { "DataSourceId", "MetricKey", "RecordedAt" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_MetricSamples_DataSourceId_MetricKey_RecordedAt",
                table: "MetricSamples");

            migrationBuilder.CreateIndex(
                name: "IX_MetricSamples_DataSourceId",
                table: "MetricSamples",
                column: "DataSourceId");
        }
    }
}
