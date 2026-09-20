using PersonalDashboard.Api.Domain;
using PersonalDashboard.Api.Health;
using PersonalDashboard.Api.Endpoints;
using Xunit;

namespace PersonalDashboard.Api.Tests;

public class ReadinessCalculatorTests
{
    private static readonly ClientClock Clock = new(-60) { UtcNow = new DateTime(2026, 9, 19, 12, 0, 0, DateTimeKind.Utc) };
    private static MetricSample Sample(string key, double value, DateTimeOffset? at = null, string? source = null) =>
        new() { MetricKey = key, Value = value, RecordedAt = at ?? Clock.TodayStartUtc.AddHours(8),
            DataSource = source is null ? null : new DataSource { Name = source, Kind = SourceKind.Garmin } };
    private static List<MetricSample> Complete() =>
        [Sample("sleep_score", 80), Sample("resting_hr", 55), Sample("stress_avg", 30)];

    [Fact]
    public void Missing_measurements_never_get_a_default_score()
    {
        var result = ReadinessCalculator.Calculate([], Clock, 55);
        Assert.Null(result.Score);
        Assert.All(result.Components, c => { Assert.Equal("missing", c.Status); Assert.Null(c.Value); });
        Assert.Null(ReadinessCalculator.Calculate([Sample("sleep_score", 80)], Clock, 55).Score);
    }

    [Fact]
    public void Recent_measurements_use_the_same_weighted_calculation_and_personal_baseline()
    {
        Assert.Equal(82, ReadinessCalculator.Calculate(Complete(), Clock, 55).Score);
        // Lowering the reference by five reduces the HR component by forty: .25 × 40 = 10.
        Assert.Equal(72, ReadinessCalculator.Calculate(Complete(), Clock, 50).Score);
    }

    [Fact]
    public void Older_values_are_labelled_and_excluded()
    {
        var samples = Complete();
        samples[0].RecordedAt = Clock.TodayStartUtc.AddDays(-1).AddTicks(-1);
        var result = ReadinessCalculator.Calculate(samples, Clock, 55);
        Assert.Null(result.Score);
        Assert.Equal("stale", result.Components[0].Status);
        Assert.Equal(80, result.Components[0].Value);
    }

    [Fact]
    public void Yesterday_boundary_uses_the_clients_local_calendar()
    {
        var samples = Complete();
        samples[0].RecordedAt = Clock.TodayStartUtc.AddDays(-1);
        Assert.Equal(82, ReadinessCalculator.Calculate(samples, Clock, 55).Score);
        samples[0].RecordedAt = Clock.TodayEndUtc;
        Assert.Null(ReadinessCalculator.Calculate(samples, Clock, 55).Score);
    }

    [Theory]
    [InlineData("Garmin (imported)", "derived")]
    [InlineData("Garmin (sample)", "sample")]
    public void Synthetic_measurements_cannot_generate_readiness(string source, string status)
    {
        var samples = Complete();
        samples[0] = Sample("sleep_score", 80, source: source);
        var result = ReadinessCalculator.Calculate(samples, Clock, 55);
        Assert.Null(result.Score);
        Assert.Equal(status, result.Components[0].Status);
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(101)]
    [InlineData(double.NaN)]
    public void Invalid_measurements_are_excluded(double value)
    {
        var samples = Complete(); samples[0].Value = value;
        var result = ReadinessCalculator.Calculate(samples, Clock, 55);
        Assert.Null(result.Score);
        Assert.Equal("invalid", result.Components[0].Status);
    }

    [Fact]
    public void Newer_synthetic_or_invalid_records_do_not_hide_a_recent_observed_measurement()
    {
        var samples = Complete();
        samples.Add(Sample("sleep_score", 99, Clock.TodayStartUtc.AddHours(10), "Garmin (imported)"));
        samples.Add(Sample("resting_hr", -1, Clock.TodayStartUtc.AddHours(10)));
        var result = ReadinessCalculator.Calculate(samples, Clock, 55);
        Assert.Equal(82, result.Score);
        Assert.All(result.Components, c => Assert.Equal("fresh", c.Status));
        Assert.Equal(80, result.Components[0].Value);
    }

    [Fact]
    public void Settings_reject_invalid_denominators_and_preserve_optional_artist_targets()
    {
        Assert.Null(SettingsEndpoints.Validate(new DashboardSettings()));
        Assert.NotNull(SettingsEndpoints.Validate(new DashboardSettings { ProteinGTarget = 0 }));
        Assert.NotNull(SettingsEndpoints.Validate(new DashboardSettings { SleepScoreTarget = 101 }));
        Assert.NotNull(SettingsEndpoints.Validate(new DashboardSettings { ArtistFollowersTarget = -1 }));
        Assert.Null(SettingsEndpoints.Validate(new DashboardSettings { ArtistMonthlyListenersTarget = 0, ArtistFollowersTarget = 0, ArtistTotalStreamsTarget = 0 }));
    }
}
