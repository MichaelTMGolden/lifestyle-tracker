using PersonalDashboard.Api.Domain;
using PersonalDashboard.Api.Schedule;
using Xunit;

namespace PersonalDashboard.Api.Tests;

public class SchedulePrecedenceTests
{
    private static readonly DateTimeOffset TodayStart = new(2026, 6, 7, 0, 0, 0, TimeSpan.Zero);

    // One event spanning 19:00–21:00.
    private static readonly CalendarEvent Dinner = new()
    {
        Title = "Dinner with friends",
        StartsAt = TodayStart.AddMinutes(19 * 60),
        EndsAt = TodayStart.AddMinutes(21 * 60),
    };

    // Planned blocks: two inside the event window, one well before it.
    private static (int start, int dur, string act)[] Blocks => new[]
    {
        (7 * 60, 60, "Morning routine"),       // 07:00–08:00  → not overlapped
        (18 * 60 + 30, 120, "Light reading"),  // 18:30–20:30  → overlapped
        (20 * 60 + 30, 30, "Wind down"),       // 20:30–21:00  → overlapped
    };

    [Fact]
    public void Event_spanning_several_blocks_flags_exactly_those_blocks()
    {
        var events = new[] { Dinner };
        var flags = Blocks
            .Select(b => SchedulePrecedence.IsOverlapped(b.start, b.dur, TodayStart, events))
            .ToArray();

        Assert.Equal(new[] { false, true, true }, flags);
    }

    [Fact]
    public void Event_appears_once_and_strikes_nothing()
    {
        var events = new[] { Dinner };

        // The event set is never duplicated by the precedence pass...
        Assert.Single(events);
        // ...and the rule only ever returns a bool — there is no path that
        // copies the event title onto a block (the old re-stamping bug).
        var overlapped = SchedulePrecedence.IsOverlapped(18 * 60 + 30, 120, TodayStart, events);
        Assert.IsType<bool>(overlapped);
        Assert.True(overlapped);
    }

    [Fact]
    public void No_events_means_no_overlap()
    {
        Assert.False(SchedulePrecedence.IsOverlapped(18 * 60 + 30, 120, TodayStart, Array.Empty<CalendarEvent>()));
    }
}
