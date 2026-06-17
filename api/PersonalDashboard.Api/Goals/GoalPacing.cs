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
    string State, DateOnly? CompletedOn, bool Archived, bool CountAllTime,
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
            .Include(g => g.Sources).ThenInclude(s => s.Habit).ThenInclude(h => h!.Logs)
            .OrderByDescending(g => g.TargetMinutes)
            .ToListAsync();

        var result = new List<GoalPacing>();
        var newlyCompleted = false;
        foreach (var g in goals)
        {
            // The goal's own timeline start (drives the on-track pace); defaults to creation.
            var start = g.StartDate ?? today;
            // Where minutes start counting toward the target:
            //   Total      → all-time (every feeder minute ever logged counts).
            //   Additional → only minutes logged on/after the start date.
            var countFrom = g.CountAllTime ? DateOnly.MinValue : start;
            var feeders = g.Sources.Where(s => s.Habit is not null).ToList();
            var sources = feeders
                .Select(s => new GoalSourceDto(
                    s.HabitId, s.Habit!.Name,
                    s.Habit!.Logs.Where(l => l.Date >= countFrom).Sum(l => l.Minutes)))
                .OrderByDescending(s => s.Minutes)
                .ToList();

            var accumulated = sources.Sum(s => s.Minutes);
            var remaining = Math.Max(0, g.TargetMinutes - accumulated);
            var progress = g.TargetMinutes > 0 ? Math.Min(1.0, accumulated / (double)g.TargetMinutes) : 0;

            var logs = feeders.SelectMany(s => s.Habit!.Logs)
                .Where(l => l.Date >= countFrom).ToList();
            var weekly = logs.Where(l => l.Date >= weekAgo).Sum(l => l.Minutes);
            var dailyRate = logs.Where(l => l.Date >= since28).Sum(l => l.Minutes) / 28.0;

            // Lifetime rate spans since the goal started (additional) or since the
            // earliest counted log (total).
            var earliest = logs.Count > 0 ? logs.Min(l => l.Date) : (DateOnly?)null;
            var rateStart = g.CountAllTime ? (earliest ?? start) : start;
            var daysActive = Math.Max(1, today.DayNumber - rateStart.DayNumber);
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
                // Expected-progress is measured from when the goal started (its start date).
                var span = target.DayNumber - start.DayNumber;
                expectedFraction = span > 0 ? Math.Clamp((today.DayNumber - start.DayNumber) / (double)span, 0, 1) : 1;
                if (projectedDate is DateOnly pd) projectedVsTarget = pd.DayNumber - target.DayNumber;
                // Schedule-relative pace for the on-track pill: how many plan-days actual
                // progress trails (+) or leads (-) the straight-line expected progress.
                // Bounded by the goal span, so a brand-new goal reads "on pace" instead of
                // extrapolating its full remaining target into an alarming projection.
                if (span > 0) paceGapDays = (int)Math.Round((expectedFraction.Value - progress) * span);
            }

            // Stamp the completion date the first time the target is reached, so the
            // achievement (and how long it took) is preserved even as feeders keep logging.
            if (remaining == 0 && g.CompletedOn is null) { g.CompletedOn = today; newlyCompleted = true; }
            else if (remaining > 0 && g.CompletedOn is not null && !g.Archived) { g.CompletedOn = null; newlyCompleted = true; }

            var state = g.CompletedOn is not null ? "complete"
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
                state, g.CompletedOn, g.Archived, g.CountAllTime, sources));
        }
        if (newlyCompleted) await db.SaveChangesAsync();
        return result;
    }
}
