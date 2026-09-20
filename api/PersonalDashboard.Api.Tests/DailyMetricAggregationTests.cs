using PersonalDashboard.Api.Domain;
using PersonalDashboard.Api.Health;
using Xunit;

namespace PersonalDashboard.Api.Tests;

public class DailyMetricAggregationTests
{
    private static MetricSample Sample(string key, double value, int day = 19, int hour = 12, long id = 1, string source = "Garmin") => new()
    {
        Id = id, MetricKey = key, Value = value,
        RecordedAt = new DateTimeOffset(2026, 9, day, hour, 0, 0, TimeSpan.Zero),
        DataSource = new DataSource { Name = source, Kind = SourceKind.Garmin },
    };

    [Fact]
    public void Multiple_snapshots_select_the_final_total_not_a_sum()
    {
        var rows = DailyMetricAggregation.Select([
            Sample("steps", 3000, hour: 8), Sample("steps", 8000, hour: 12),
            Sample("calories_in", 600, hour: 8, source: "Manual"), Sample("calories_in", 1800, hour: 12, source: "Manual"),
        ]);
        Assert.Equal(2, rows.Count);
        Assert.Equal(8000, rows.Single(row => row.MetricKey == "steps").Value);
        Assert.Equal(1800, rows.Single(row => row.MetricKey == "calories_in").Value);
    }

    [Fact]
    public void Daily_series_keep_one_reading_per_date_in_date_order()
    {
        var rows = DailyMetricAggregation.Select([
            Sample("sleep_score", 80, day: 19), Sample("sleep_score", 50, day: 18),
            Sample("sleep_score", 60, day: 18, id: 2), Sample("sleep_score", 90, day: 17),
        ]);
        Assert.Equal(new double[] { 90, 60, 80 }, rows.Select(row => row.Value));
        Assert.Equal(230.0 / 3, rows.Average(row => row.Value));
    }

    [Fact]
    public void Genuine_zero_is_preserved_while_missing_and_synthetic_readings_are_absent()
    {
        var rows = DailyMetricAggregation.Select([
            Sample("steps", 0), Sample("steps", 8000, hour: 13, source: "Garmin (sample)"),
            Sample("sleep_score", 85, source: "Garmin (imported)"),
            Sample("body_battery", 101), Sample("calories_in", double.NaN), Sample("active_calories", -50),
        ]);
        Assert.Equal(0, Assert.Single(rows).Value);
        Assert.DoesNotContain(rows, row => row.MetricKey == "calories_in");
    }
}
