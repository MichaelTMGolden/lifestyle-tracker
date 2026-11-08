using Microsoft.EntityFrameworkCore;
using PersonalDashboard.Api.Data;
using PersonalDashboard.Api.Domain;

namespace PersonalDashboard.Api.Endpoints;

/// <summary>
/// Habit writes that are safe to replay, for taps queued offline and sent later:
/// they name the day they were made for, and adding minutes carries a request
/// id so a repeat is recognised instead of counted twice.
/// </summary>
public static class HabitWrites
{
    /// <summary>How far back a queued write may still land (a phone offline for a few days).</summary>
    public const int MaxBackfillDays = 7;

    public enum Outcome { Applied, Duplicate, NotFound, OutOfRange }

    /// <summary>A day a client may write to: not in its future, not older than the backfill window.</summary>
    public static bool InRange(DateOnly date, DateOnly today) => date <= today && date >= today.AddDays(-MaxBackfillDays);

    /// <summary>Mark a day done or not done. Setting the same state again changes nothing; minutes are kept.</summary>
    public static async Task<Outcome> SetDoneAsync(AppDbContext db, int habitId, DateOnly date, bool done, DateOnly today)
    {
        if (!InRange(date, today)) return Outcome.OutOfRange;
        if (!await db.Habits.AnyAsync(h => h.Id == habitId)) return Outcome.NotFound;
        var log = await db.HabitLogs.FirstOrDefaultAsync(l => l.HabitId == habitId && l.Date == date);
        if (log is null)
        {
            if (!done) return Outcome.Applied; // nothing logged is already "not done"
            db.HabitLogs.Add(new HabitLog { HabitId = habitId, Date = date, Completed = true });
        }
        else log.Completed = done;
        await db.SaveChangesAsync();
        return Outcome.Applied;
    }

    /// <summary>
    /// Add practice minutes to a day and mark it done. With a request id, the id is
    /// stored in the same save as the minutes, so a replayed request is a no-op.
    /// </summary>
    public static async Task<Outcome> AddMinutesAsync(AppDbContext db, int habitId, DateOnly date, int minutes, Guid? requestId, DateOnly today)
    {
        if (!InRange(date, today)) return Outcome.OutOfRange;
        if (requestId is Guid id && await db.AppliedRequests.AnyAsync(r => r.Id == id)) return Outcome.Duplicate;
        if (!await db.Habits.AnyAsync(h => h.Id == habitId)) return Outcome.NotFound;

        var log = await db.HabitLogs.FirstOrDefaultAsync(l => l.HabitId == habitId && l.Date == date);
        if (log is null) db.HabitLogs.Add(new HabitLog { HabitId = habitId, Date = date, Completed = true, Minutes = minutes });
        else { log.Minutes += minutes; log.Completed = true; }
        if (requestId is Guid key) db.AppliedRequests.Add(new AppliedRequest { Id = key, AppliedAt = DateTimeOffset.UtcNow });

        try { await db.SaveChangesAsync(); }
        catch (DbUpdateException) when (requestId is not null)
        {
            // The same request raced in from another connection and won: nothing to add.
            if (await IsAppliedAsync(db, requestId.Value)) return Outcome.Duplicate;
            throw;
        }
        return Outcome.Applied;
    }

    private static async Task<bool> IsAppliedAsync(AppDbContext db, Guid id)
    {
        db.ChangeTracker.Clear();
        return await db.AppliedRequests.AsNoTracking().AnyAsync(r => r.Id == id);
    }
}
