using PersonalDashboard.Api.Domain;

namespace PersonalDashboard.Api.Health;

public record SleepNightSummary(DateOnly Date, double Deep, double Light, double Rem, double Awake,
    double? Score, bool HasCompleteStages, IReadOnlyList<string> Sources);

public static class SleepAggregation
{
    public static readonly string[] Keys = ["sleep_deep_min", "sleep_light_min", "sleep_rem_min", "sleep_awake_min", "sleep_score"];

    public static IReadOnlyList<SleepNightSummary> Build(IEnumerable<MetricSample> samples) => samples
        .Where(IsValidMeasurement)
        // These are calendar-date summaries, not additive activity events. A sync or
        // second source must replace a day's value rather than lengthen its night.
        .GroupBy(sample => DateOnly.FromDateTime(sample.RecordedAt.UtcDateTime))
        .OrderBy(day => day.Key)
        .Select(day =>
        {
            var latest = day.GroupBy(sample => sample.MetricKey).ToDictionary(group => group.Key,
                group => group.OrderByDescending(sample => sample.RecordedAt).ThenByDescending(sample => sample.Id).First());
            double Value(string key) => latest.TryGetValue(key, out var sample) ? sample.Value : 0;
            return new SleepNightSummary(day.Key,
                Value("sleep_deep_min"), Value("sleep_light_min"), Value("sleep_rem_min"), Value("sleep_awake_min"),
                latest.TryGetValue("sleep_score", out var score) ? score.Value : null,
                new[] { "sleep_deep_min", "sleep_light_min", "sleep_rem_min" }.All(latest.ContainsKey),
                latest.Values.Select(sample => sample.DataSource?.Name).Where(name => name is not null)
                    .Select(name => name!).Distinct().OrderBy(name => name).ToArray());
        }).ToArray();

    private static bool IsValidMeasurement(MetricSample sample)
    {
        if (!Keys.Contains(sample.MetricKey) || !double.IsFinite(sample.Value) || sample.Value < 0) return false;
        var source = sample.DataSource?.Name ?? "";
        if (source.Contains("(sample)", StringComparison.OrdinalIgnoreCase)) return false;
        if (sample.MetricKey == "sleep_score")
            return sample.Value <= 100 && !source.Contains("(imported)", StringComparison.OrdinalIgnoreCase);
        return sample.Value <= 1440;
    }
}
