using Microsoft.EntityFrameworkCore;
using PersonalDashboard.Api.Data;
using PersonalDashboard.Api.Endpoints; // NutritionTargets
using PersonalDashboard.Api.Goals;

namespace PersonalDashboard.Api.Reviews;

// Fact-only digest records. Every fact carries a stable `Id` so the LLM's output
// can reference it — the model judges/prioritises but never recomputes a number.
public record DigestGoal(string Id, string Name, int MinutesThisWeek, int MinutesLastWeek,
    double AccumulatedHours, double TargetHours, string PaceStatus, string? ProjectedDate, string? TargetDate, bool CountAllTime);
public record DigestSkill(string Id, string Name, int MinutesThisWeek, int MinutesLastWeek, int CurrentStreak, int DaysCompletedThisWeek);
public record DigestMetric(string Id, string Key, string Label, double? AvgThisWeek, double? AvgLastWeek, double? Delta, string Unit);
public record DigestNutrition(string Id, double? AvgCalories, double CalorieTarget, double? AvgProtein, double ProteinTarget, int DaysLogged, int ProteinDaysOnTarget);
public record DigestAlert(string Id, string Kind, string Severity, string Title, string Detail);
public record DigestTasks(string Id, int CompletedThisWeek, int Overdue);

public record WeeklyDigest(
    DateOnly WeekStart, DateOnly WeekEnd,
    List<DigestGoal> Goals, List<DigestSkill> Skills, List<DigestMetric> Health,
    DigestNutrition Nutrition, List<DigestAlert> Alerts, DigestTasks Tasks);

/// <summary>
/// Assembles a compact, fact-only snapshot of a week (and the prior week, for
/// comparison) from the DB. Pure data — no LLM, independently testable. Reuses
/// GoalPacing for goal status; computes per-week sums directly from logs/samples.
/// </summary>
public static class WeeklyDigestService
{
    private static readonly (string Key, string Label, string Unit, bool AsHours)[] HealthKeys =
    {
        ("sleep_total_min", "Sleep", "h", true),
        ("sleep_score", "Sleep score", "score", false),
        ("resting_hr", "Resting HR", "bpm", false),
        ("stress_avg", "Stress", "level", false),
        ("steps", "Steps", "steps", false),
    };

    public static async Task<WeeklyDigest> BuildAsync(AppDbContext db, DateOnly weekStart, DateOnly today)
    {
        var weekEnd = weekStart.AddDays(7);        // exclusive
        var prevStart = weekStart.AddDays(-7);
        var startUtc = new DateTimeOffset(weekStart.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);
        var endUtc = new DateTimeOffset(weekEnd.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);
        var prevStartUtc = new DateTimeOffset(prevStart.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);

        // --- skills (habits) with their logs ---
        var habits = await db.Habits.AsNoTracking().Where(h => !h.Archived).OrderBy(h => h.Id)
            .Select(h => new
            {
                h.Id, h.Name,
                logs = h.Logs.Select(l => new { l.Date, l.Minutes, l.Completed }).ToList(),
            })
            .ToListAsync();

        var thisWeekByHabit = new Dictionary<int, int>();
        var lastWeekByHabit = new Dictionary<int, int>();
        var skills = new List<DigestSkill>();
        foreach (var h in habits)
        {
            var thisMin = h.logs.Where(l => l.Date >= weekStart && l.Date < weekEnd).Sum(l => l.Minutes);
            var lastMin = h.logs.Where(l => l.Date >= prevStart && l.Date < weekStart).Sum(l => l.Minutes);
            thisWeekByHabit[h.Id] = thisMin;
            lastWeekByHabit[h.Id] = lastMin;
            var doneDates = h.logs.Where(l => l.Completed).Select(l => l.Date).ToHashSet();
            skills.Add(new DigestSkill(
                $"skill:{h.Id}", h.Name, thisMin, lastMin,
                CurrentStreak(doneDates, today),
                doneDates.Count(d => d >= weekStart && d < weekEnd)));
        }

        // --- goals (status via pacing; weekly effort from logs) ---
        var pacings = await GoalPacingService.ComputeAsync(db, today);
        var goals = pacings.Where(g => !g.Archived).Select(g => new DigestGoal(
            $"goal:{g.Id}", g.Name,
            g.Sources.Sum(s => thisWeekByHabit.GetValueOrDefault(s.HabitId)),
            g.Sources.Sum(s => lastWeekByHabit.GetValueOrDefault(s.HabitId)),
            Math.Round(g.AccumulatedMinutes / 60.0, 1), Math.Round(g.TargetMinutes / 60.0, 1),
            g.PaceStatus ?? g.State,
            g.ProjectedDate?.ToString("yyyy-MM-dd"), g.TargetDate?.ToString("yyyy-MM-dd"),
            g.CountAllTime)).ToList();

        // --- health: weekly averages vs prior week ---
        var health = new List<DigestMetric>();
        foreach (var (key, label, unit, asHours) in HealthKeys)
        {
            var thisAvg = await db.MetricSamples.AsNoTracking()
                .Where(m => m.MetricKey == key && m.RecordedAt >= startUtc && m.RecordedAt < endUtc)
                .AverageAsync(m => (double?)m.Value);
            var lastAvg = await db.MetricSamples.AsNoTracking()
                .Where(m => m.MetricKey == key && m.RecordedAt >= prevStartUtc && m.RecordedAt < startUtc)
                .AverageAsync(m => (double?)m.Value);
            double? Conv(double? v) => v is null ? null : asHours ? Math.Round(v.Value / 60.0, 1) : Math.Round(v.Value, key == "steps" ? 0 : 1);
            var t = Conv(thisAvg); var l = Conv(lastAvg);
            if (t is null && l is null) continue; // nothing tracked — omit
            health.Add(new DigestMetric($"health:{key}", key, label, t, l,
                (t is not null && l is not null) ? Math.Round(t.Value - l.Value, 1) : null, unit));
        }

        // --- nutrition: avg calories/protein vs target, days logged/on-target ---
        var nutri = await db.MetricSamples.AsNoTracking()
            .Where(m => (m.MetricKey == "calories_in" || m.MetricKey == "protein_g") && m.RecordedAt >= startUtc && m.RecordedAt < endUtc)
            .Select(m => new { m.MetricKey, m.Value, Day = m.RecordedAt })
            .ToListAsync();
        var calVals = nutri.Where(n => n.MetricKey == "calories_in").Select(n => n.Value).ToList();
        var proVals = nutri.Where(n => n.MetricKey == "protein_g").Select(n => n.Value).ToList();
        var nutrition = new DigestNutrition("nutrition",
            calVals.Count > 0 ? Math.Round(calVals.Average()) : null, NutritionTargets.Calories,
            proVals.Count > 0 ? Math.Round(proVals.Average()) : null, NutritionTargets.ProteinG,
            calVals.Count, proVals.Count(p => p >= NutritionTargets.ProteinG));

        // --- active alerts ---
        var alerts = (await db.Alerts.AsNoTracking()
            .Where(a => a.Status != "Dismissed")
            .OrderByDescending(a => a.DetectedAt).Take(12).ToListAsync())
            .Select(a => new DigestAlert($"alert:{a.Id}", a.Kind, a.Severity, a.Title, a.Detail)).ToList();

        // --- tasks ---
        var completed = await db.TodoItems.CountAsync(t => t.CompletedAt != null && t.CompletedAt >= startUtc && t.CompletedAt < endUtc);
        var overdue = await db.TodoItems.CountAsync(t => t.CompletedAt == null && t.DueAt != null && t.DueAt < startUtc.AddDays(7));
        var tasks = new DigestTasks("tasks", completed, overdue);

        return new WeeklyDigest(weekStart, weekEnd.AddDays(-1), goals, skills, health, nutrition, alerts, tasks);
    }

    // Consecutive completed days ending today (or yesterday if today not yet done).
    private static int CurrentStreak(HashSet<DateOnly> done, DateOnly today)
    {
        var d = today;
        if (!done.Contains(d)) d = d.AddDays(-1);
        var n = 0;
        while (done.Contains(d)) { n++; d = d.AddDays(-1); }
        return n;
    }
}
