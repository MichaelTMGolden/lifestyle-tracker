using PersonalDashboard.Api.Domain;

namespace PersonalDashboard.Api.Health;

/// <summary>Daily metric values are cumulative snapshots, never additive events.</summary>
public static class DailyMetricAggregation
{
    public static IReadOnlyList<MetricSample> Select(IEnumerable<MetricSample> samples) => samples
        .Where(IsValidObserved)
        .GroupBy(sample => new { sample.MetricKey, Date = DateOnly.FromDateTime(sample.RecordedAt.UtcDateTime) })
        .Select(group => group.OrderByDescending(sample => sample.RecordedAt).ThenByDescending(sample => sample.Id).First())
        .OrderBy(sample => sample.RecordedAt).ToArray();

    public static bool IsValidObserved(MetricSample sample)
    {
        if (!double.IsFinite(sample.Value) || sample.Value < 0) return false;
        var source = sample.DataSource?.Name ?? "";
        if (source.Contains("(sample)", StringComparison.OrdinalIgnoreCase)) return false;
        if (sample.MetricKey is "sleep_score" or "resting_hr" or "stress_avg")
        {
            if (source.Contains("(imported)", StringComparison.OrdinalIgnoreCase)) return false;
            return sample.MetricKey == "resting_hr" ? sample.Value is >= 20 and <= 250 : sample.Value <= 100;
        }
        return sample.MetricKey != "body_battery" || sample.Value <= 100;
    }
}
