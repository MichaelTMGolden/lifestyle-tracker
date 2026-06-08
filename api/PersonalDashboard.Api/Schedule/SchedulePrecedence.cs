using PersonalDashboard.Api.Domain;

namespace PersonalDashboard.Api.Schedule;

/// <summary>
/// Calendar-precedence rule, extracted so it's unit-testable. A planned block is
/// only ever *flagged* as overlapped by a calendar event — never struck through,
/// and event titles are never copied onto blocks (events render once, on their
/// own row). This pure helper is the single source of that rule.
/// </summary>
public static class SchedulePrecedence
{
    /// <summary>True if any event overlaps the block's [start, start+duration) window today.</summary>
    public static bool IsOverlapped(int startMinutes, int? durationMinutes,
        DateTimeOffset todayStart, IEnumerable<CalendarEvent> events)
    {
        var blockStart = todayStart.AddMinutes(startMinutes);
        var blockEnd = blockStart.AddMinutes(durationMinutes ?? 0);
        return events.Any(e => e.StartsAt < blockEnd && e.EndsAt > blockStart);
    }
}
