using Microsoft.EntityFrameworkCore;
using PersonalDashboard.Api.Domain;
using PersonalDashboard.Api.Goals;

namespace PersonalDashboard.Api.Alerts;

// Thresholds are hardcoded here; the obvious place to make them user-tunable later
// (a settings row read in DetectAsync).

/// <summary>Z-score anomalies on key metrics vs the trailing-28-day mean ± stddev.</summary>
public class MetricAnomalyDetector : IAlertDetector
{
    private static readonly (string Key, string Label, string Unit)[] Metrics =
    {
        ("resting_hr", "Resting HR", "bpm"),
        ("hrv", "HRV", "ms"),
        ("sleep_score", "Sleep score", ""),
        ("stress_avg", "Stress", ""),
    };

    public async Task<IEnumerable<Alert>> DetectAsync(AlertContext ctx, CancellationToken ct = default)
    {
        var alerts = new List<Alert>();
        var since = new DateTimeOffset(ctx.Today.AddDays(-29).ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);

        foreach (var (key, label, unit) in Metrics)
        {
            var samples = await ctx.Db.MetricSamples
                .Where(m => m.MetricKey == key && m.RecordedAt >= since)
                .Select(m => new { m.RecordedAt, m.Value })
                .ToListAsync(ct);
            if (samples.Count == 0) continue;

            var byDay = samples
                .GroupBy(s => DateOnly.FromDateTime(s.RecordedAt.UtcDateTime.Date))
                .ToDictionary(g => g.Key, g => g.Average(x => x.Value));
            if (!byDay.TryGetValue(ctx.Today, out var todayVal)) continue;

            var baseline = byDay.Where(kv => kv.Key < ctx.Today).Select(kv => kv.Value).ToList();
            if (baseline.Count < 7) continue; // not enough history to judge

            var mean = baseline.Average();
            var sd = Math.Sqrt(baseline.Sum(v => (v - mean) * (v - mean)) / baseline.Count);
            if (sd < 1e-6) continue;

            var z = (todayVal - mean) / sd;
            if (Math.Abs(z) < 2) continue;

            var kind = z > 0 ? "MetricSpike" : "MetricDrop";
            var unitSuffix = unit.Length > 0 ? " " + unit : "";
            var low = Math.Round(mean - sd);
            var high = Math.Round(mean + sd);
            alerts.Add(new Alert
            {
                Kind = kind, Severity = Math.Abs(z) >= 3 ? "Urgent" : "Watch",
                SubjectType = "Metric", SubjectKey = key,
                Title = $"{label} {Math.Round(todayVal)}{unitSuffix}",
                Detail = $"Your usual is {low:0}–{high:0}{unitSuffix}.",
                Value = Math.Round(todayVal, 1), ExpectedLow = low, ExpectedHigh = high,
                ForDate = ctx.Today, DetectedAt = ctx.Now,
                DedupeKey = $"{kind}:{key}:{ctx.Today:yyyy-MM-dd}",
            });
        }
        return alerts;
    }
}

/// <summary>Accumulated sleep deficit over the trailing 7 days vs an 8h/night target.</summary>
public class SleepDebtDetector : IAlertDetector
{
    private const double TargetHours = 8;          // tunable later (or read a sleep-target metric)
    private const double DebtThresholdHours = 5;

    public async Task<IEnumerable<Alert>> DetectAsync(AlertContext ctx, CancellationToken ct = default)
    {
        var since = new DateTimeOffset(ctx.Today.AddDays(-6).ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);
        var samples = await ctx.Db.MetricSamples
            .Where(m => m.MetricKey == "sleep_total_min" && m.RecordedAt >= since)
            .Select(m => new { m.RecordedAt, m.Value })
            .ToListAsync(ct);
        if (samples.Count == 0) return Array.Empty<Alert>();

        var byDay = samples
            .GroupBy(s => DateOnly.FromDateTime(s.RecordedAt.UtcDateTime.Date))
            .ToDictionary(g => g.Key, g => g.Average(x => x.Value) / 60.0);

        double debt = 0;
        for (var i = 0; i < 7; i++)
            if (byDay.TryGetValue(ctx.Today.AddDays(-i), out var hrs))
                debt += Math.Max(0, TargetHours - hrs);

        if (debt < DebtThresholdHours) return Array.Empty<Alert>();
        return new[]
        {
            new Alert
            {
                Kind = "SleepDebt", Severity = debt >= 10 ? "Urgent" : "Watch",
                SubjectType = "Metric", SubjectKey = "sleep_total_min",
                Title = $"Sleep debt {Math.Round(debt)}h this week",
                Detail = $"You're ~{Math.Round(debt)}h under an {TargetHours:0}h/night target over the last 7 days.",
                Value = Math.Round(debt, 1), ForDate = ctx.Today, DetectedAt = ctx.Now,
                DedupeKey = $"SleepDebt:{ctx.Today:yyyy-MM-dd}",
            },
        };
    }
}

/// <summary>A fresh broken streak (≥5 days) per habit, plus a single inactivity alert.</summary>
public class StreakBreakDetector : IAlertDetector
{
    private const int MinStreak = 5;
    private const int InactivityDays = 3;

    public async Task<IEnumerable<Alert>> DetectAsync(AlertContext ctx, CancellationToken ct = default)
    {
        var alerts = new List<Alert>();
        var habits = await ctx.Db.Habits.Where(h => !h.Archived)
            .Select(h => new { h.Id, h.Name, h.TracksTime, Dates = h.Logs.Where(l => l.Completed).Select(l => l.Date).ToList() })
            .ToListAsync(ct);

        foreach (var h in habits)
        {
            if (h.Dates.Count == 0) continue;
            var set = h.Dates.ToHashSet();
            var lastDone = h.Dates.Max();
            var gap = ctx.Today.DayNumber - lastDone.DayNumber;

            var streak = 0;
            for (var c = lastDone; set.Contains(c); c = c.AddDays(-1)) streak++;

            // Fresh break: a real streak ended 1–2 full days ago.
            if (streak >= MinStreak && gap is >= 2 and <= 3)
            {
                alerts.Add(new Alert
                {
                    Kind = "StreakBreak", Severity = "Watch", SubjectType = "Habit", SubjectKey = h.Id.ToString(),
                    Title = $"{h.Name} streak broke",
                    Detail = $"Your {streak}-day {h.Name} streak ended — last logged {lastDone:MMM d}.",
                    Value = streak, ForDate = ctx.Today, DetectedAt = ctx.Now,
                    DedupeKey = $"StreakBreak:{h.Id}:{lastDone:yyyy-MM-dd}",
                });
            }
        }

        var timedDates = habits.Where(h => h.TracksTime).SelectMany(h => h.Dates).ToList();
        if (timedDates.Count > 0)
        {
            var lastAny = timedDates.Max();
            var idle = ctx.Today.DayNumber - lastAny.DayNumber;
            if (idle >= InactivityDays)
                alerts.Add(new Alert
                {
                    Kind = "Inactivity", Severity = "Watch", SubjectType = "Habit", SubjectKey = "timed",
                    Title = $"No practice in {idle} days",
                    Detail = $"Nothing logged across your timed skills since {lastAny:MMM d}.",
                    Value = idle, ForDate = ctx.Today, DetectedAt = ctx.Now,
                    DedupeKey = $"Inactivity:{lastAny:yyyy-MM-dd}",
                });
        }
        return alerts;
    }
}

/// <summary>Goals with a target date that are projected to finish late (reuses Feature A pacing).</summary>
public class GoalOffPaceDetector : IAlertDetector
{
    private const int BufferDays = 7;

    public async Task<IEnumerable<Alert>> DetectAsync(AlertContext ctx, CancellationToken ct = default)
    {
        var pacings = await GoalPacingService.ComputeAsync(ctx.Db, ctx.Today);
        var alerts = new List<Alert>();
        foreach (var g in pacings)
        {
            if (g.Archived || g.TargetDate is null || g.State == "complete") continue;
            if (g.AccumulatedMinutes == 0) continue; // not started yet — don't nag on untouched goals
            var lateDays = g.ProjectedVsTargetDays;
            var behind = (lateDays.HasValue && lateDays.Value > BufferDays) || g.PaceStatus == "behind";
            if (!behind) continue;

            var when = g.TargetDate.Value.ToDateTime(TimeOnly.MinValue);
            alerts.Add(new Alert
            {
                Kind = "GoalOffPace", Severity = (lateDays ?? 0) > 60 || g.State == "overdue" ? "Urgent" : "Watch",
                SubjectType = "Goal", SubjectKey = g.Id.ToString(),
                Title = $"{g.Name} is behind pace",
                Detail = lateDays.HasValue
                    ? $"At your current pace you'll finish ~{FmtSpan(lateDays.Value)} after {when:MMM yyyy}."
                    : $"You're below the pace needed to hit {when:MMM yyyy}.",
                Value = lateDays, ForDate = ctx.Today, DetectedAt = ctx.Now,
                DedupeKey = $"GoalOffPace:{g.Id}",
            });
        }
        return alerts;
    }

    private static string FmtSpan(int days)
    {
        var d = Math.Abs(days);
        return d >= 14 ? $"{d / 7} weeks" : $"{d} days";
    }
}
