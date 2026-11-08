using PersonalDashboard.Api;
using PersonalDashboard.Api.Domain;
using PersonalDashboard.Api.Endpoints;
using Xunit;

namespace PersonalDashboard.Api.Tests;

/// <summary>The Plan page's day range: events overlapping the client's local days.</summary>
public class CalendarDaysTests
{
    private static CalendarEvent Ev(string title, DateTimeOffset start, DateTimeOffset end, bool allDay = false) =>
        new() { Title = title, StartsAt = start, EndsAt = end, AllDay = allDay };

    private static List<string> Overlapping(IEnumerable<CalendarEvent> events, ClientClock clock, int days) =>
        ApiEndpoints.OverlappingEvents(events.AsQueryable(), clock.TodayStartUtc, clock.TodayStartUtc.AddDays(days)).Select(e => e.Title).ToList();

    [Fact]
    public void An_event_already_under_way_today_is_included()
    {
        var clock = new ClientClock(0) { UtcNow = new DateTime(2026, 11, 8, 15, 0, 0, DateTimeKind.Utc) };
        var events = new[] { Ev("Ongoing", new(2026, 11, 8, 14, 0, 0, TimeSpan.Zero), new(2026, 11, 8, 16, 0, 0, TimeSpan.Zero)) };
        Assert.Equal(["Ongoing"], Overlapping(events, clock, 7));
    }

    [Fact]
    public void Todays_all_day_event_is_included_west_of_utc()
    {
        // Los Angeles (UTC-8): getTimezoneOffset() is +480. All-day events are stored at UTC midnight.
        var clock = new ClientClock(480) { UtcNow = new DateTime(2026, 11, 8, 20, 0, 0, DateTimeKind.Utc) };
        var events = new[]
        {
            Ev("Yesterday all day", new(2026, 11, 7, 0, 0, 0, TimeSpan.Zero), new(2026, 11, 8, 0, 0, 0, TimeSpan.Zero), allDay: true),
            Ev("Today all day", new(2026, 11, 8, 0, 0, 0, TimeSpan.Zero), new(2026, 11, 9, 0, 0, 0, TimeSpan.Zero), allDay: true),
        };
        Assert.Equal(["Today all day"], Overlapping(events, clock, 7));
    }

    [Fact]
    public void Events_ended_before_today_or_after_the_range_are_left_out()
    {
        var clock = new ClientClock(0) { UtcNow = new DateTime(2026, 11, 8, 9, 0, 0, DateTimeKind.Utc) };
        var events = new[]
        {
            Ev("Last night", new(2026, 11, 7, 20, 0, 0, TimeSpan.Zero), new(2026, 11, 7, 22, 0, 0, TimeSpan.Zero)),
            Ev("Day 7", new(2026, 11, 14, 10, 0, 0, TimeSpan.Zero), new(2026, 11, 14, 11, 0, 0, TimeSpan.Zero)),
            Ev("Day 8", new(2026, 11, 15, 10, 0, 0, TimeSpan.Zero), new(2026, 11, 15, 11, 0, 0, TimeSpan.Zero)),
        };
        Assert.Equal(["Day 7"], Overlapping(events, clock, 7));
    }
}
