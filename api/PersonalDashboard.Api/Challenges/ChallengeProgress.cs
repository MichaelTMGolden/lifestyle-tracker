using PersonalDashboard.Api.Domain;

namespace PersonalDashboard.Api.Challenges;

public record ChallengeEntryDto(int Id, DateOnly Date, double Amount, string? Label);

/// <summary>
/// A challenge plus its computed progress. The headline figure depends on the
/// mode: Daily-strict reports the current consecutive-day streak; Daily-forgiving
/// reports distinct days done; Quantity reports the summed amount.
/// </summary>
public record ChallengeDto(
    int Id, string Name, string Mode, int Target, string? Unit, bool Strict,
    DateOnly StartDate, DateOnly? TargetDate, bool Completed, DateTimeOffset? CompletedAt,
    bool Archived, string? ColorHex,
    int DaysDone, int CurrentStreak, double Total, double Progress, bool IsComplete,
    List<ChallengeEntryDto> Entries);

/// <summary>
/// Pure progress computation for a <see cref="Challenge"/>. Everything is derived
/// from the date-stamped entries — so filling a past gap repairs a strict chain
/// automatically (the consecutive run is recomputed from the actual dates).
/// </summary>
public static class ChallengeProgress
{
    public record Computed(int DaysDone, int CurrentStreak, double Total, double Progress, bool IsComplete);

    public static Computed Compute(Challenge c, DateOnly today)
    {
        var dates = c.Entries.Select(e => e.Date).ToHashSet();
        var daysDone = dates.Count;
        var streak = CurrentStreak(dates, today);
        var total = c.Entries.Sum(e => e.Amount);

        double progress;
        bool complete;
        if (c.Mode == ChallengeMode.Quantity)
        {
            progress = c.Target > 0 ? total / c.Target : 0;
            complete = total >= c.Target;
        }
        else if (c.Strict)
        {
            progress = c.Target > 0 ? (double)streak / c.Target : 0;
            complete = streak >= c.Target;
        }
        else // Daily forgiving
        {
            progress = c.Target > 0 ? (double)daysDone / c.Target : 0;
            complete = daysDone >= c.Target;
        }
        return new Computed(daysDone, streak, total, Math.Min(progress, 1.0), complete);
    }

    /// <summary>Consecutive dated days ending today (or yesterday if today isn't ticked yet).</summary>
    private static int CurrentStreak(HashSet<DateOnly> dates, DateOnly today)
    {
        var d = today;
        if (!dates.Contains(d)) d = d.AddDays(-1);
        var n = 0;
        while (dates.Contains(d)) { n++; d = d.AddDays(-1); }
        return n;
    }

    public static ChallengeDto ToDto(Challenge c, DateOnly today)
    {
        var p = Compute(c, today);
        var entries = c.Entries
            .OrderBy(e => e.Date).ThenBy(e => e.Id)
            .Select(e => new ChallengeEntryDto(e.Id, e.Date, e.Amount, e.Label))
            .ToList();
        return new ChallengeDto(
            c.Id, c.Name, c.Mode.ToString(), c.Target, c.Unit, c.Strict,
            c.StartDate, c.TargetDate, c.Completed, c.CompletedAt, c.Archived, c.ColorHex,
            p.DaysDone, p.CurrentStreak, p.Total, p.Progress, p.IsComplete, entries);
    }

    /// <summary>
    /// Keep the stored Completed/CompletedAt flag in sync with current progress.
    /// Setting on first reaching target, and clearing if a retroactive edit drops
    /// it back below — so un-logging a mistake un-completes cleanly.
    /// </summary>
    public static void ApplyCompletion(Challenge c, DateOnly today, DateTimeOffset now)
    {
        var complete = Compute(c, today).IsComplete;
        if (complete && !c.Completed) { c.Completed = true; c.CompletedAt = now; }
        else if (!complete && c.Completed) { c.Completed = false; c.CompletedAt = null; }
    }
}
