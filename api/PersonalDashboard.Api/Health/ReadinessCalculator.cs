using PersonalDashboard.Api.Domain;

namespace PersonalDashboard.Api.Health;

public record ReadinessComponent(string Key, string Label, double? Value,
    DateTimeOffset? RecordedAt, string Status, double? Score);
public record ReadinessResult(int? Score, string Label, IReadOnlyList<ReadinessComponent> Components);

/// <summary>A descriptive estimate, requiring all three recent measurements. Missing values never receive defaults.</summary>
public static class ReadinessCalculator
{
    public static ReadinessResult Calculate(IEnumerable<MetricSample> samples, ClientClock clock, double restingHrBaseline)
    {
        var data = samples.ToList();
        ReadinessComponent Component(string key, string label, Func<double, bool> valid, Func<double, double> score)
        {
            // Day-level Garmin data may be timestamped later in the current calendar day.
            var candidates = data.Where(m => m.MetricKey == key && m.RecordedAt < clock.TodayEndUtc)
                .OrderByDescending(m => m.RecordedAt).ThenByDescending(m => m.Id).ToList();
            // An invalid import or sample record must not shadow a genuine recent reading.
            var latest = candidates.FirstOrDefault(m => double.IsFinite(m.Value) && valid(m.Value) &&
                !(m.DataSource?.Name ?? "").Contains("(sample)", StringComparison.OrdinalIgnoreCase) &&
                !(m.DataSource?.Name ?? "").Contains("(imported)", StringComparison.OrdinalIgnoreCase))
                ?? candidates.FirstOrDefault();
            if (latest is null) return new(key, label, null, null, "missing", null);
            var source = latest.DataSource?.Name ?? "";
            var status = source.Contains("(sample)", StringComparison.OrdinalIgnoreCase) ? "sample"
                : source.Contains("(imported)", StringComparison.OrdinalIgnoreCase) ? "derived"
                : !double.IsFinite(latest.Value) || !valid(latest.Value) ? "invalid"
                : latest.RecordedAt < clock.TodayStartUtc.AddDays(-1) ? "stale" : "fresh";
            return new(key, label, double.IsFinite(latest.Value) ? latest.Value : null,
                latest.RecordedAt, status, status == "fresh" ? Math.Clamp(score(latest.Value), 0, 100) : null);
        }

        var components = new[]
        {
            Component("sleep_score", "Sleep", v => v is >= 0 and <= 100, v => v),
            Component("resting_hr", "Resting HR", v => v is >= 20 and <= 250,
                v => 100 - (v - restingHrBaseline) * 8),
            Component("stress_avg", "Stress", v => v is >= 0 and <= 100, v => 100 - v),
        };
        if (components.Any(c => c.Score is null))
            return new(null, components.Any(c => c.Status == "stale") ? "Needs fresh data" : "Needs data", components);
        var value = (int)Math.Round(.45 * components[0].Score!.Value + .25 * components[1].Score!.Value
            + .30 * components[2].Score!.Value, MidpointRounding.AwayFromZero);
        return new(value, value >= 80 ? "Primed" : value >= 65 ? "Steady" : value >= 45 ? "Strained" : "Depleted", components);
    }
}
