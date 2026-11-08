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

public record HabitInput(string Name, bool TracksTime);

public record MinutesInput(int Minutes);
/// <summary>Minutes to add; Date and RequestId let an offline tap replay safely (see HabitWrites).</summary>
public record LogTimeInput(int Minutes, DateOnly? Date = null, Guid? RequestId = null);
public record DoneInput(bool Done);

// Habits, their logs and heatmap, and running timers.
public static partial class ApiEndpoints
{
    /// <summary>
    /// Consecutive days with a completed log ending at today. If today isn't
    /// logged yet we count up to yesterday, so an unlogged today doesn't zero a
    /// live streak. A gap (missed day) breaks it.
    /// </summary>
    private static int CurrentStreak(IEnumerable<DateOnly> completedDates, DateOnly today)
    {
        var set = completedDates as ISet<DateOnly> ?? completedDates.ToHashSet();
        var cursor = set.Contains(today) ? today : today.AddDays(-1);
        var n = 0;
        while (set.Contains(cursor)) { n++; cursor = cursor.AddDays(-1); }
        return n;
    }

    /// <summary>
    /// How far back a streak is read before falling back to full history. A
    /// streak that reaches this far back (over a year unbroken) is rare, so the
    /// common case reads a bounded window instead of every log ever written.
    /// </summary>
    public const int StreakWindowDays = 400;

    public record HabitRow(
        int Id, string Name, string Cadence, int TargetPerPeriod, bool TracksTime, bool ShowInQuickActions,
        int Last30Completed, bool DoneToday, int MinutesToday, int TotalMinutes, int TotalCompletions, int CurrentStreak,
        int BestStreak, int? ReminderMinutes);

    /// <summary>
    /// The active habits as the Habits and Today pages show them. Pass
    /// <paramref name="onlyId"/> to build one row, so a mutation can hand back
    /// the habit it just changed instead of the client reloading everything.
    /// </summary>
    internal static async Task<List<HabitRow>> HabitRowsAsync(AppDbContext db, DateOnly today, int? onlyId = null)
    {
        var since = today.AddDays(-30);
        var habits = db.Habits.AsNoTracking().Where(h => !h.Archived);
        if (onlyId is int id) habits = habits.Where(h => h.Id == id);
        var rows = await habits
            .OrderBy(h => h.Id)
            .Select(h => new
            {
                h.Id, h.Name, h.Cadence, h.TargetPerPeriod, h.TracksTime, h.ShowInQuickActions, h.ReminderMinutes,
                last30Completed = h.Logs.Count(l => l.Date >= since && l.Completed),
                doneToday = h.Logs.Any(l => l.Date == today && l.Completed),
                minutesToday = h.Logs.Where(l => l.Date == today).Sum(l => (int?)l.Minutes) ?? 0,
                totalMinutes = h.Logs.Sum(l => (int?)l.Minutes) ?? 0,
                totalCompletions = h.Logs.Count(l => l.Completed),
            })
            .ToListAsync();
        if (rows.Count == 0) return [];

        var ids = rows.Select(r => r.Id).ToList();
        var windowStart = today.AddDays(-StreakWindowDays);
        var dates = await CompletedDatesAsync(db, ids, windowStart, today);
        var streaks = new Dictionary<int, int>();
        var needFullHistory = new List<int>();
        foreach (var r in rows)
        {
            var result = HabitCadencePolicy.StreakWithin(dates.GetValueOrDefault(r.Id) ?? [], today, r.Cadence, r.TargetPerPeriod, windowStart);
            if (result.MayExtendPastWindow) needFullHistory.Add(r.Id);
            else streaks[r.Id] = result.Streak;
        }
        if (needFullHistory.Count > 0)
        {
            var full = await CompletedDatesAsync(db, needFullHistory, null, today);
            foreach (var r in rows.Where(r => needFullHistory.Contains(r.Id)))
                streaks[r.Id] = HabitCadencePolicy.Streak(full.GetValueOrDefault(r.Id) ?? [], today, r.Cadence, r.TargetPerPeriod);
        }

        // Best run within the window already read; a current streak older than the window is longer still.
        return rows.Select(r => new HabitRow(
            r.Id, r.Name, r.Cadence, r.TargetPerPeriod, r.TracksTime, r.ShowInQuickActions,
            r.last30Completed, r.doneToday, r.minutesToday, r.totalMinutes, r.totalCompletions, streaks[r.Id],
            Math.Max(streaks[r.Id], HabitCadencePolicy.BestStreak(dates.GetValueOrDefault(r.Id) ?? [], today, r.Cadence, r.TargetPerPeriod, windowStart)),
            r.ReminderMinutes)).ToList();
    }

    private static async Task<Dictionary<int, HashSet<DateOnly>>> CompletedDatesAsync(AppDbContext db, List<int> habitIds, DateOnly? from, DateOnly to)
    {
        var logs = db.HabitLogs.AsNoTracking().Where(l => habitIds.Contains(l.HabitId) && l.Completed && l.Date <= to);
        if (from is DateOnly start) logs = logs.Where(l => l.Date >= start);
        var pairs = await logs.Select(l => new { l.HabitId, l.Date }).ToListAsync();
        return pairs.GroupBy(p => p.HabitId).ToDictionary(g => g.Key, g => g.Select(p => p.Date).ToHashSet());
    }

    /// <summary>One habit's row after a change, or null when it is archived or missing.</summary>
    internal static async Task<HabitRow?> HabitRowAsync(AppDbContext db, DateOnly today, int id) =>
        (await HabitRowsAsync(db, today, id)).FirstOrDefault();

    internal static async Task<object> HabitHeatmapAsync(AppDbContext db, DateOnly today, int days)
    {
        var since = today.AddDays(-days);
        return await db.Habits
            .Where(h => !h.Archived)
            .OrderBy(h => h.Id)
            .Select(h => new
            {
                h.Id,
                h.Name,
                h.TracksTime,
                h.Cadence, h.TargetPerPeriod,
                // presence = "on"; minutes drives intensity shading for timed skills
                days = h.Logs.Where(l => l.Date >= since && l.Completed)
                    .Select(l => new { l.Date, l.Minutes })
                    .ToList(),
                // kept for backward compatibility with existing callers
                completedDates = h.Logs.Where(l => l.Date >= since && l.Completed)
                    .Select(l => l.Date)
                    .ToList(),
            })
            .ToListAsync();
    }

    internal static async Task<object> ActiveTimersAsync(AppDbContext db) =>
        await db.HabitTimers.AsNoTracking()
            .OrderBy(t => t.StartedAt)
            .Select(t => new { habitId = t.HabitId, habitName = t.Habit!.Name, startedAt = t.StartedAt.ToUnixTimeMilliseconds() })
            .ToListAsync();

    private static void MapHabits(RouteGroupBuilder api)
    {
        // --- Habits ---
        api.MapGet("/habits", async (AppDbContext db, HttpRequest req) =>
            await HabitRowsAsync(db, ClientClock.From(req).Today));

        // --- GitHub-style contribution data: active days (+minutes) per habit ---
        api.MapGet("/habits/heatmap", async (AppDbContext db, HttpRequest req, int days = 182) =>
            await HabitHeatmapAsync(db, ClientClock.From(req).Today, days));

        api.MapPost("/habits/{id:int}/toggle", async (int id, AppDbContext db, HttpRequest req) =>
        {
            var today = ClientClock.From(req).Today;
            var log = await db.HabitLogs.FirstOrDefaultAsync(l => l.HabitId == id && l.Date == today);
            if (log is null)
            {
                log = new HabitLog { HabitId = id, Date = today, Completed = true };
                db.HabitLogs.Add(log);
            }
            else
            {
                log.Completed = !log.Completed;
            }
            await db.SaveChangesAsync();
            return Results.Ok(new { log.HabitId, log.Date, log.Completed, log.Minutes, habit = await HabitRowAsync(db, today, id) });
        });

        // Add practice minutes (quick-add buttons, past sessions, offline taps). Date
        // defaults to today; a RequestId makes a replay a no-op instead of a second add.
        api.MapPost("/habits/{id:int}/log-time", async (int id, LogTimeInput body, AppDbContext db, HttpRequest req) =>
        {
            if (body.Minutes <= 0 || body.Minutes > 24 * 60)
                return Results.BadRequest(new { message = "minutes must be between 1 and 1440" });
            var today = ClientClock.From(req).Today;
            var date = body.Date ?? today;
            var outcome = await HabitWrites.AddMinutesAsync(db, id, date, body.Minutes, body.RequestId, today);
            if (outcome == HabitWrites.Outcome.NotFound) return Results.NotFound();
            if (outcome == HabitWrites.Outcome.OutOfRange)
                return Results.BadRequest(new { message = $"date must be within the last {HabitWrites.MaxBackfillDays} days" });
            // A duplicate is acknowledged even if its log (or habit) was deleted since:
            // the write was applied once, which is all a replay needs to hear.
            var log = await db.HabitLogs.AsNoTracking().FirstOrDefaultAsync(l => l.HabitId == id && l.Date == date);
            return Results.Ok(new
            {
                habitId = id, date, minutes = log?.Minutes ?? 0, completed = log?.Completed ?? false,
                duplicate = outcome == HabitWrites.Outcome.Duplicate, habit = await HabitRowAsync(db, today, id),
            });
        });

        // Set a day done or not done. Unlike toggle this names the end state and the
        // day, so a tap queued offline lands correctly however late it is sent.
        api.MapPut("/habits/{id:int}/done/{date}", async (int id, DateOnly date, DoneInput body, AppDbContext db, HttpRequest req) =>
        {
            var today = ClientClock.From(req).Today;
            var outcome = await HabitWrites.SetDoneAsync(db, id, date, body.Done, today);
            if (outcome == HabitWrites.Outcome.NotFound) return Results.NotFound();
            if (outcome == HabitWrites.Outcome.OutOfRange)
                return Results.BadRequest(new { message = $"date must be within the last {HabitWrites.MaxBackfillDays} days" });
            return Results.Ok(new { habitId = id, date, done = body.Done, habit = await HabitRowAsync(db, today, id) });
        });

        // Set today's minutes to an absolute value (corrections). Completed = minutes > 0.
        api.MapPut("/habits/{id:int}/today", async (int id, MinutesInput body, AppDbContext db, HttpRequest req) =>
        {
            if (body.Minutes < 0)
                return Results.BadRequest(new { message = "minutes cannot be negative" });
            if (!await db.Habits.AnyAsync(h => h.Id == id)) return Results.NotFound();

            var today = ClientClock.From(req).Today;
            var log = await db.HabitLogs.FirstOrDefaultAsync(l => l.HabitId == id && l.Date == today);
            if (log is null)
            {
                log = new HabitLog { HabitId = id, Date = today, Minutes = body.Minutes, Completed = body.Minutes > 0 };
                db.HabitLogs.Add(log);
            }
            else
            {
                log.Minutes = body.Minutes;
                log.Completed = body.Minutes > 0;
            }
            await db.SaveChangesAsync();
            return Results.Ok(new { log.HabitId, log.Date, log.Minutes, log.Completed, habit = await HabitRowAsync(db, today, id) });
        });

        // Recent logged entries for a habit — for reviewing/correcting bad timer data.
        api.MapGet("/habits/{id:int}/logs", async (int id, AppDbContext db, HttpRequest req, int days = 30) =>
        {
            var since = ClientClock.From(req).Today.AddDays(-Math.Clamp(days, 1, 365));
            return await db.HabitLogs.AsNoTracking()
                .Where(l => l.HabitId == id && l.Date >= since && (l.Completed || l.Minutes > 0))
                .OrderByDescending(l => l.Date)
                .Select(l => new { l.Id, l.Date, l.Minutes, l.Completed })
                .ToListAsync();
        });

        // Correct a past entry's minutes (e.g. a timer left running). Completed = minutes > 0.
        api.MapPut("/habits/{id:int}/logs/{date}", async (int id, DateOnly date, MinutesInput body, AppDbContext db) =>
        {
            if (body.Minutes < 0) return Results.BadRequest(new { message = "minutes cannot be negative" });
            var log = await db.HabitLogs.FirstOrDefaultAsync(l => l.HabitId == id && l.Date == date);
            if (log is null)
            {
                if (!await db.Habits.AnyAsync(h => h.Id == id)) return Results.NotFound();
                log = new HabitLog { HabitId = id, Date = date, Minutes = body.Minutes, Completed = body.Minutes > 0 };
                db.HabitLogs.Add(log);
            }
            else { log.Minutes = body.Minutes; log.Completed = body.Minutes > 0; }
            await db.SaveChangesAsync();
            return Results.Ok(new { log.HabitId, log.Date, log.Minutes, log.Completed });
        });

        // Delete a bad entry outright.
        api.MapDelete("/habits/{id:int}/logs/{date}", async (int id, DateOnly date, AppDbContext db) =>
        {
            await db.HabitLogs.Where(l => l.HabitId == id && l.Date == date).ExecuteDeleteAsync();
            return Results.NoContent();
        });

        // --- Running timers (server-side so they sync across devices) ---
        // Active timers, oldest first; each carries its server start time as epoch ms.
        api.MapGet("/timers", async (AppDbContext db) => await ActiveTimersAsync(db));

        // Start a timer for a habit (idempotent — keeps the existing start time if already running).
        api.MapPost("/timers/{habitId:int}", async (int habitId, AppDbContext db, HttpRequest req) =>
        {
            var habit = await db.Habits.FindAsync(habitId);
            if (habit is null) return Results.NotFound();
            var timer = await db.HabitTimers.FirstOrDefaultAsync(t => t.HabitId == habitId);
            if (timer is null)
            {
                timer = new HabitTimer { HabitId = habitId, StartedAt = new DateTimeOffset(ClientClock.From(req).UtcNow, TimeSpan.Zero) };
                db.HabitTimers.Add(timer);
                await db.SaveChangesAsync();
            }
            return Results.Ok(new { habitId, habitName = habit.Name, startedAt = timer.StartedAt.ToUnixTimeMilliseconds() });
        });

        // Stop a habit's timer from any device: rounds elapsed → minutes and logs to today.
        api.MapDelete("/timers/{habitId:int}", async (int habitId, AppDbContext db, HttpRequest req) =>
        {
            var timer = await db.HabitTimers.FirstOrDefaultAsync(t => t.HabitId == habitId);
            if (timer is null) return Results.Ok(new { habitId, minutes = 0 });

            var clock = ClientClock.From(req);
            var mins = Math.Max(0, (int)Math.Round((clock.UtcNow - timer.StartedAt.UtcDateTime).TotalMinutes));
            db.HabitTimers.Remove(timer);
            if (mins > 0)
            {
                var today = clock.Today;
                var log = await db.HabitLogs.FirstOrDefaultAsync(l => l.HabitId == habitId && l.Date == today);
                if (log is null) db.HabitLogs.Add(new HabitLog { HabitId = habitId, Date = today, Completed = true, Minutes = mins });
                else { log.Minutes += mins; log.Completed = true; }
            }
            await db.SaveChangesAsync();
            return Results.Ok(new { habitId, minutes = mins, habit = await HabitRowAsync(db, clock.Today, habitId) });
        });

        // Flip whether a skill tracks time.
        api.MapPost("/habits/{id:int}/tracks-time", async (int id, AppDbContext db) =>
        {
            var habit = await db.Habits.FindAsync(id);
            if (habit is null) return Results.NotFound();
            habit.TracksTime = !habit.TracksTime;
            await db.SaveChangesAsync();
            return Results.Ok(new { habit.Id, habit.TracksTime });
        });

        // Flip whether a skill shows in the dashboard quick-actions / quick-log.
        api.MapPost("/habits/{id:int}/quick-actions", async (int id, AppDbContext db) =>
        {
            var habit = await db.Habits.FindAsync(id);
            if (habit is null) return Results.NotFound();
            habit.ShowInQuickActions = !habit.ShowInQuickActions;
            await db.SaveChangesAsync();
            return Results.Ok(new { habit.Id, habit.ShowInQuickActions });
        });

        // Add a new tracked practice (e.g. "Exercise").
        api.MapPost("/habits", async (HabitInput input, AppDbContext db) =>
        {
            var name = input.Name?.Trim();
            if (string.IsNullOrEmpty(name)) return Results.BadRequest(new { error = "Name required" });
            if (await db.Habits.AnyAsync(h => h.Name == name && !h.Archived))
                return Results.Conflict(new { error = "A habit with that name already exists" });
            var habit = new Habit { Name = name, TracksTime = input.TracksTime };
            db.Habits.Add(habit);
            await db.SaveChangesAsync();
            return Results.Created($"/api/habits/{habit.Id}", new { habit.Id, habit.Name, habit.TracksTime });
        });

        // Remove a habit (cascades its logs and goal-feeder links).
        api.MapDelete("/habits/{id:int}", async (int id, AppDbContext db) =>
        {
            var habit = await db.Habits.FindAsync(id);
            if (habit is null) return Results.NotFound();
            db.Habits.Remove(habit);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });
    }
}
