using PersonalDashboard.Api.Domain;
using PersonalDashboard.Api.Health;
using Xunit;

namespace PersonalDashboard.Api.Tests;

public class SleepAggregationTests
{
    private static MetricSample Sample(string key, double value, int hour = 8, long id = 1, string source = "Garmin") => new()
    {
        Id = id, MetricKey = key, Value = value,
        RecordedAt = new DateTimeOffset(2026, 9, 19, hour, 0, 0, TimeSpan.Zero),
        DataSource = new DataSource { Name = source, Kind = SourceKind.Garmin },
    };

    [Fact]
    public void Duplicate_sources_and_syncs_do_not_add_together()
    {
        var night = Assert.Single(SleepAggregation.Build([
            Sample("sleep_deep_min", 50), Sample("sleep_deep_min", 70, hour: 9, source: "Device B"),
            Sample("sleep_light_min", 200), Sample("sleep_rem_min", 90), Sample("sleep_awake_min", 10),
            Sample("sleep_score", 75), Sample("sleep_score", 85, hour: 9),
        ]));
        Assert.Equal(70, night.Deep);
        Assert.Equal(200, night.Light);
        Assert.Equal(85, night.Score);
        Assert.True(night.HasCompleteStages);
        Assert.Equal(new[] { "Device B", "Garmin" }, night.Sources);
    }

    [Fact]
    public void Equal_timestamps_choose_the_latest_id_and_invalid_updates_are_ignored()
    {
        var night = Assert.Single(SleepAggregation.Build([
            Sample("sleep_deep_min", 50, id: 1), Sample("sleep_deep_min", 70, id: 2),
            Sample("sleep_deep_min", -1, hour: 9), Sample("sleep_light_min", double.NaN),
            Sample("sleep_rem_min", 1500), Sample("sleep_score", 101),
        ]));
        Assert.Equal(70, night.Deep);
        Assert.False(night.HasCompleteStages);
        Assert.Null(night.Score);
    }

    [Fact]
    public void Imported_durations_remain_visible_but_synthetic_scores_and_samples_are_excluded()
    {
        var night = Assert.Single(SleepAggregation.Build([
            Sample("sleep_deep_min", 60, source: "Garmin (imported)"),
            Sample("sleep_score", 90, source: "Garmin (imported)"),
            Sample("sleep_light_min", 240, source: "Garmin (sample)"),
        ]));
        Assert.Equal(60, night.Deep);
        Assert.Equal(0, night.Light);
        Assert.Null(night.Score);
        Assert.False(night.HasCompleteStages);
        Assert.Equal(new[] { "Garmin (imported)" }, night.Sources);
    }

    [Fact]
    public void Actual_zero_stage_is_distinguished_from_a_missing_stage()
    {
        var night = Assert.Single(SleepAggregation.Build([
            Sample("sleep_deep_min", 0), Sample("sleep_light_min", 300), Sample("sleep_rem_min", 0),
        ]));
        Assert.True(night.HasCompleteStages);
        Assert.Equal(0, night.Rem);
    }
}
