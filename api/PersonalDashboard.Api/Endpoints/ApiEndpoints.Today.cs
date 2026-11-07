using System.Net.Http.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.EntityFrameworkCore;
using PersonalDashboard.Api;
using PersonalDashboard.Api.Data;
using PersonalDashboard.Api.Domain;
using PersonalDashboard.Api.Alerts;
using PersonalDashboard.Api.Challenges;
using PersonalDashboard.Api.Garmin;
using PersonalDashboard.Api.Goals;
using PersonalDashboard.Api.Health;
using PersonalDashboard.Api.Integrations;
using PersonalDashboard.Api.Nutrition;
using PersonalDashboard.Api.Reviews;
using PersonalDashboard.Api.Schedule;

namespace PersonalDashboard.Api.Endpoints;

// The Today page's summary.
public static partial class ApiEndpoints
{
    internal static async Task<object> TodaySummaryAsync(AppDbContext db, ClientClock clock)
    {
        var todayStart = clock.TodayStartUtc;
        var todayEnd = clock.TodayEndUtc;
        var todayOnly = clock.Today;
        var nowMinutes = clock.NowMinutes;

        // Daily health and nutrition samples carry their source's calendar date.
        // Multiple syncs/sources replace a day's snapshot; they must not add up.
        var metricEnd = new DateTimeOffset(todayOnly.AddDays(1).ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);
        var metricStart = metricEnd.AddDays(-14);
        var summaryKeys = new[] { "steps", "calories_in", "sleep_score", "resting_hr", "body_battery" };
        var summaryRows = await db.MetricSamples.AsNoTracking().Include(m => m.DataSource)
            .Where(m => summaryKeys.Contains(m.MetricKey) && m.RecordedAt >= metricStart && m.RecordedAt < metricEnd)
            .ToListAsync();
        var dailyMetrics = DailyMetricAggregation.Select(summaryRows);
        double? TodayValue(string key) => dailyMetrics
            .FirstOrDefault(m => m.MetricKey == key && DateOnly.FromDateTime(m.RecordedAt.UtcDateTime) == todayOnly)?.Value;
        var stepsToday = TodayValue("steps");
        var caloriesInToday = TodayValue("calories_in");

        var settings = await db.DashboardSettings.AsNoTracking().FirstOrDefaultAsync() ?? new DashboardSettings();
        var readinessSamples = await db.MetricSamples.AsNoTracking().Include(m => m.DataSource)
            .Where(m => m.MetricKey == "sleep_score" || m.MetricKey == "resting_hr" || m.MetricKey == "stress_avg")
            .OrderByDescending(m => m.RecordedAt).Take(1100).ToListAsync();
        var readinessResult = ReadinessCalculator.Calculate(readinessSamples, clock, settings.RestingHrBaseline);
        double? FreshValue(string key) => readinessResult.Components.First(c => c.Key == key) is { Status: "fresh" } c ? c.Value : null;
        var restingHr = FreshValue("resting_hr");
        var lastSleepScore = FreshValue("sleep_score");

        var bodyBattery = dailyMetrics.LastOrDefault(m => m.MetricKey == "body_battery" &&
            DateOnly.FromDateTime(m.RecordedAt.UtcDateTime) >= todayOnly.AddDays(-1))?.Value;

        var habitsTotal = await db.Habits.CountAsync(h => !h.Archived);
        var habitsCompletedToday = await db.HabitLogs.CountAsync(l => l.Date == todayOnly && l.Completed);

        var todosDueToday = await db.TodoItems.CountAsync(t =>
            t.CompletedAt == null && t.DueAt != null && t.DueAt >= todayStart && t.DueAt < todayEnd);
        var todosOverdue = await db.TodoItems.CountAsync(t =>
            t.CompletedAt == null && t.DueAt != null && t.DueAt < todayStart);

        // Recent 14-day sparklines + averages for the homepage health summary.
        List<double> Spark(string key) => dailyMetrics.Where(m => m.MetricKey == key).Select(m => m.Value).ToList();
        var sleepSpark = Spark("sleep_score");
        var rhrSpark = Spark("resting_hr");
        var stepsSpark = Spark("steps");
        var sleepAvg14 = sleepSpark.Count > 0 ? Math.Round(sleepSpark.Average()) : (double?)null;
        var readiness = readinessResult.Score;
        var readinessLabel = readinessResult.Label;

        // Next-up from the schedule (current block if now is inside one, else the next).
        var dow = clock.DayOfWeek;
        await EnsureScheduleCurrentAsync(db, todayOnly);
        var todays = await db.ScheduleBlocks.AsNoTracking().Where(b => b.Day == dow)
            .OrderBy(b => b.StartMinutes).ToListAsync();
        var appointments = await db.CalendarEvents.AsNoTracking()
            .Where(e => e.StartsAt < todayEnd.AddDays(1) && e.EndsAt > todayStart).ToListAsync();
        var agenda = DayAgenda.Build(todays, appointments, todayStart);
        var current = DayAgenda.Current(agenda, nowMinutes);
        var next = agenda.FirstOrDefault(b => b.StartMinutes > nowMinutes);

        // Tomorrow's first block (for the evening wind-down preview).
        var tomorrowDow = (DayOfWeek)(((int)dow + 1) % 7);
        var tomorrowBlocks = await db.ScheduleBlocks.AsNoTracking()
            .Where(b => b.Day == tomorrowDow).OrderBy(b => b.StartMinutes)
            .ToListAsync();
        var tomorrowFirst = DayAgenda.Build(tomorrowBlocks, appointments, todayEnd).FirstOrDefault();

        return new
        {
            stepsToday = stepsToday.HasValue ? Math.Round(stepsToday.Value) : (double?)null,
            caloriesInToday = caloriesInToday.HasValue ? Math.Round(caloriesInToday.Value) : (double?)null,
            restingHr,
            bodyBattery = bodyBattery.HasValue ? Math.Round(bodyBattery.Value) : (double?)null,
            lastSleepScore = lastSleepScore.HasValue ? Math.Round(lastSleepScore.Value) : (double?)null,
            sleepAvg14,
            sleepSpark,
            rhrSpark,
            stepsSpark,
            readiness,
            readinessLabel,
            readinessComponents = readinessResult.Components,
            settings,
            habitsCompletedToday,
            habitsTotal,
            todosDueToday,
            todosOverdue,
            nowMinutes,
            current = current == null ? null : new
            {
                current.Activity,
                current.StartMinutes,
                current.DurationMinutes,
                category = current.Category.ToString(),
            },
            next = next == null ? null : new
            {
                next.Activity,
                next.StartMinutes,
                category = next.Category.ToString(),
            },
            tomorrowFirst,
        };
    }

    private static void MapToday(RouteGroupBuilder api)
    {
        // --- At-a-glance "today" rollup for the homepage ---
        api.MapGet("/today", async (AppDbContext db, HttpRequest req) => Results.Ok(await TodaySummaryAsync(db, ClientClock.From(req))));
    }
}
