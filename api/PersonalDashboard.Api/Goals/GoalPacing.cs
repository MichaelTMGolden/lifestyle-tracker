using Microsoft.EntityFrameworkCore;
using PersonalDashboard.Api.Data;

namespace PersonalDashboard.Api.Goals;

public record GoalSourceDto(int HabitId, string Name, int Minutes);

/// <summary>
/// A goal plus its computed pacing/projection. Returned by GET /api/goals and
/// reused by the GoalOffPace alert detector. Pace fields are null when the goal
/// has no TargetDate (plain ETA projection only).
/// </summary>
public record GoalPacing(
    int Id, string Name, int TargetMinutes, string? ColorHex,
    DateOnly? StartDate, DateOnly? TargetDate,
    int AccumulatedMinutes, double Progress, int RemainingMinutes, int WeeklyMinutes,
    double DailyRateMinutes, double LifetimeDailyRateMinutes,
    DateOnly? ProjectedDate,
    double? RequiredDailyRateMinutes, string? PaceStatus, double? PaceDeltaMinutesPerDay,
    double? ExpectedFraction, int? ProjectedVsTargetDays, int? PaceGapDays,
    string State,
    List<GoalSourceDto> Sources);

public static class GoalPacingService
{
    /// <summary>
    /// Compute pacing for every non-archived goal as of <paramref name="today"/>.
    /// dailyRate uses a trailing 28-day window; lifetimeDailyRate uses days since
    /// the plan start. (Thresholds like the 28-day window could become tunable later.)
    /// </summary>
    public static async Task<List<GoalPacing>> ComputeAsync(AppDbContext db, DateOnly today)
    {
        var since28 = today.AddDays(-28);
        var weekAgo = today.AddDays(-7);

        var goals = await db.Goals
            .Where(g => !g.Archived)
            .Include(g => g.Sources).ThenInclude(s => s.Habit).ThenInclude(h => h!.Logs)
            .OrderByDescending(g => g.TargetMinutes)
            .ToListAsync();

        var result = new List<GoalPacing>();
        foreach (var g in goals)
        {
            var feeders = g.Sources.Where(s => s.Habit is not null).ToList();
            var sources = feeders
                .Select(s => new GoalSourceDto(
                    s.HabitId, s.Habit!.Name,
                    s.Habit!.Logs.Where(l => g.StartDate == null || l.Date >= g.StartDate).Sum(l => l.Minutes)))
                .OrderByDescending(s => s.Minutes)
                .ToList();

            var accumulated = sources.Sum(s => s.Minutes);
            var remaining = Math.Max(0, g.TargetMinutes - accumulated);
            var progress = g.TargetMinutes > 0 ? Math.Min(1.0, accumulated / (double)g.TargetMinutes) : 0;

            var logs = feeders.SelectMany(s => s.Habit!.Logs)
                .Where(l => g.StartDate == null || l.Date >= g.StartDate).ToList();
            var weekly = logs.Where(l => l.Date >= weekAgo).Sum(l => l.Minutes);
            var dailyRate = logs.Where(l => l.Date >= since28).Sum(l => l.Minutes) / 28.0;

            var earliest = logs.Count > 0 ? logs.Min(l => l.Date) : (DateOnly?)null;
            var planStart = g.StartDate ?? earliest ?? today;
            var daysActive = Math.Max(1, today.DayNumber - planStart.DayNumber);
            var lifetimeDailyRate = accumulated / (double)daysActive;

            DateOnly? projectedDate = remaining == 0 ? today
                : dailyRate > 0 ? today.AddDays((int)Math.Ceiling(remaining / dailyRate))
                : null;

            double? requiredDaily = null, paceDelta = null, expectedFraction = null;
            string? paceStatus = null;
            int? projectedVsTarget = null, paceGapDays = null;
            if (g.TargetDate is DateOnly target)
            {
                var daysUntil = Math.Max(1, target.DayNumber - today.DayNumber);
                requiredDaily = remaining / (double)daysUntil;
                paceStatus = dailyRate >= requiredDaily ? "ahead" : "behind";
                paceDelta = dailyRate - requiredDaily.Value;
                // Expected-progress is measured from when the goal itself started — an
                // explicit StartDate, else today. (planStart can reach back to the earliest
                // feeder log for the lifetime rate, but anchoring the *schedule* there would
                // treat a goal you just created as months overdue.)
                var scheduleStart = g.StartDate ?? today;
                var span = target.DayNumber - scheduleStart.DayNumber;
                expectedFraction = span > 0 ? Math.Clamp((today.DayNumber - scheduleStart.DayNumber) / (double)span, 0, 1) : 1;
                if (projectedDate is DateOnly pd) projectedVsTarget = pd.DayNumber - target.DayNumber;
                // Schedule-relative pace for the on-track pill: how many plan-days actual
                // progress trails (+) or leads (-) the straight-line expected progress.
                // Bounded by the goal span, so a brand-new goal reads "on pace" instead of
                // extrapolating its full remaining target into an alarming projection.
                if (span > 0) paceGapDays = (int)Math.Round((expectedFraction.Value - progress) * span);
            }

            var state = remaining == 0 ? "complete"
                : g.TargetDate is DateOnly t && t < today ? "overdue"
                : dailyRate == 0 ? "stalled"
                : "active";

            result.Add(new GoalPacing(
                g.Id, g.Name, g.TargetMinutes, g.ColorHex, g.StartDate, g.TargetDate,
                accumulated, progress, remaining, weekly,
                Math.Round(dailyRate, 2), Math.Round(lifetimeDailyRate, 2),
                projectedDate,
                requiredDaily is double rd ? Math.Round(rd, 2) : null, paceStatus,
                paceDelta is double pdm ? Math.Round(pdm, 2) : null,
                expectedFraction is double ef ? Math.Round(ef, 4) : null, projectedVsTarget, paceGapDays,
                state, sources));
        }
        return result;
    }
}
