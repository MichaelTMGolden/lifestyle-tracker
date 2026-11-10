using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using PersonalDashboard.Api.Data;
using PersonalDashboard.Api.Domain;
using PersonalDashboard.Api.Endpoints;

namespace PersonalDashboard.Api.Integrations;

/// <summary>A workout as a source describes it, before it is stored.</summary>
public record IncomingWorkout(
    string ExternalId, string Type, string? Title, DateTimeOffset StartedAt, DateTimeOffset? EndedAt,
    int DurationMinutes, double? DistanceMeters, int? Calories, int? AverageHeartRate,
    IReadOnlyList<IncomingSet>? Sets = null);

public record IncomingSet(int ExerciseIndex, string Exercise, string? ExerciseTemplateId, int SetIndex, string Kind,
    double? WeightKg, int? Reps, double? DistanceMeters, int? DurationSeconds, double? Rpe);

/// <summary>Which habit a workout of each kind ticks (null = none).</summary>
public record WorkoutHabits(int? Strength, int? Run, int? Other);

/// <summary>
/// Stores workouts from any source: one row per (source, external id), updated in
/// place on re-sync. A workout seen for the first time can tick a chosen habit.
/// </summary>
public static class WorkoutStore
{
    public const string HabitsKey = "workouts.habits";

    public static async Task<DataSource> SourceAsync(AppDbContext db, SourceKind kind, string name)
    {
        var src = await db.DataSources.FirstOrDefaultAsync(s => s.Kind == kind && s.Name == name);
        if (src is not null) return src;
        src = new DataSource { Name = name, Kind = kind };
        db.DataSources.Add(src);
        await db.SaveChangesAsync();
        return src;
    }

    /// <summary>Strength, Run or the source's own type, from a free-form name.</summary>
    public static string NormalizeType(string? raw)
    {
        var t = (raw ?? "").Trim().ToLowerInvariant();
        if (t.Contains("run") || t.Contains("jog")) return "Run";
        if (t.Contains("walk") || t.Contains("hik")) return "Walk";
        if (t.Contains("cycl") || t.Contains("bik") || t.Contains("ride")) return "Cycling";
        if (t.Contains("swim")) return "Swim";
        if (t.Contains("strength") || t.Contains("weight") || t.Contains("functional") || t.Contains("lift")) return "Strength";
        if (t.Contains("yoga") || t.Contains("pilates") || t.Contains("stretch") || t.Contains("mobility")) return "Mobility";
        return t.Length == 0 ? "Workout" : char.ToUpperInvariant(t[0]) + t[1..];
    }

    /// <summary>Saves or updates one workout; true when it is new.</summary>
    /// <param name="dayOf">The local day a moment falls on (the user's time zone).</param>
    public static async Task<bool> UpsertAsync(AppDbContext db, DataSource source, IncomingWorkout w, DateOnly today, WorkoutHabits? habits, Func<DateTimeOffset, DateOnly> dayOf)
    {
        var row = await db.Workouts.Include(x => x.Sets).FirstOrDefaultAsync(x => x.DataSourceId == source.Id && x.ExternalId == w.ExternalId);
        var created = row is null;
        if (row is null) db.Workouts.Add(row = new Workout { DataSourceId = source.Id, ExternalId = w.ExternalId, Type = w.Type });
        row.Type = w.Type;
        row.Title = Truncate(w.Title, 200);
        row.StartedAt = w.StartedAt.ToUniversalTime();
        row.EndedAt = w.EndedAt?.ToUniversalTime();
        row.DurationMinutes = Math.Max(0, w.DurationMinutes);
        row.DistanceMeters = w.DistanceMeters is > 0 ? w.DistanceMeters : null;
        row.Calories = w.Calories is > 0 ? w.Calories : null;
        row.AverageHeartRate = w.AverageHeartRate is > 0 ? w.AverageHeartRate : null;
        if (w.Sets is not null)
        {
            db.WorkoutSets.RemoveRange(row.Sets);
            row.Sets = w.Sets.Select(s => new WorkoutSet
            {
                ExerciseIndex = s.ExerciseIndex, Exercise = Truncate(s.Exercise, 200) ?? "Exercise",
                ExerciseTemplateId = Truncate(s.ExerciseTemplateId, 64), SetIndex = s.SetIndex, Kind = Truncate(s.Kind, 16) ?? "normal",
                WeightKg = s.WeightKg, Reps = s.Reps, DistanceMeters = s.DistanceMeters, DurationSeconds = s.DurationSeconds, Rpe = s.Rpe,
            }).ToList();
        }
        await db.SaveChangesAsync();
        if (created && habits is not null) await TickHabitAsync(db, source, w, today, habits, dayOf);
        return created;
    }

    /// <summary>
    /// A new workout ticks its kind's habit on the workout's day: minutes for a
    /// timed habit, done otherwise. Repeats and older history are ignored by the
    /// habit writes themselves (request id per workout; 7-day window).
    /// </summary>
    static async Task TickHabitAsync(AppDbContext db, DataSource source, IncomingWorkout w, DateOnly today, WorkoutHabits habits, Func<DateTimeOffset, DateOnly> dayOf)
    {
        var habitId = w.Type switch { "Strength" => habits.Strength, "Run" => habits.Run, _ => habits.Other };
        if (habitId is not int id) return;
        var habit = await db.Habits.AsNoTracking().FirstOrDefaultAsync(h => h.Id == id && !h.Archived);
        if (habit is null) return;
        var day = dayOf(w.StartedAt);
        if (!HabitWrites.InRange(day, today)) return;
        if (habit.TracksTime && w.DurationMinutes > 0)
            await HabitWrites.AddMinutesAsync(db, id, day, w.DurationMinutes, RequestId(source.Kind, w.ExternalId), today);
        else
            await HabitWrites.SetDoneAsync(db, id, day, true, today);
    }

    /// <summary>The same id for the same workout every time, so a re-sync never adds minutes twice.</summary>
    public static Guid RequestId(SourceKind kind, string externalId) =>
        new(MD5.HashData(Encoding.UTF8.GetBytes($"workout:{kind}:{externalId}")));

    /// <summary>The day by the moment's own offset (sources that send local times, like Apple Health).</summary>
    public static DateOnly OwnDay(DateTimeOffset t) => DateOnly.FromDateTime(t.DateTime);

    /// <summary>
    /// The day in the user's time zone: the last-seen notification device's zone,
    /// else <paramref name="fallbackOffsetMinutes"/> (getTimezoneOffset-style, from the browser).
    /// </summary>
    public static async Task<Func<DateTimeOffset, DateOnly>> UserDayAsync(AppDbContext db, int fallbackOffsetMinutes)
    {
        var device = await db.PushSubscriptions.AsNoTracking().OrderByDescending(s => s.LastSeenAt).FirstOrDefaultAsync();
        return t => DateOnly.FromDateTime(device is null
            ? t.UtcDateTime.AddMinutes(-fallbackOffsetMinutes)
            : Push.ReminderPolicy.LocalNow(t.UtcDateTime, device.TimeZoneId, device.TzOffsetMinutes));
    }

    public static async Task<WorkoutHabits> HabitsAsync(AppDbContext db)
    {
        var raw = await db.AppSecrets.AsNoTracking().Where(s => s.Key == HabitsKey).Select(s => s.Value).FirstOrDefaultAsync();
        if (raw is null) return new(null, null, null);
        try { return JsonSerializer.Deserialize<WorkoutHabits>(raw) ?? new(null, null, null); } catch { return new(null, null, null); }
    }

    public static async Task SaveHabitsAsync(AppDbContext db, WorkoutHabits habits)
    {
        var row = await db.AppSecrets.FirstOrDefaultAsync(s => s.Key == HabitsKey);
        var json = JsonSerializer.Serialize(habits);
        if (row is null) db.AppSecrets.Add(new AppSecret { Key = HabitsKey, Value = json });
        else row.Value = json;
        await db.SaveChangesAsync();
    }

    static string? Truncate(string? s, int max) => s is null ? null : s.Length <= max ? s : s[..max];
}
