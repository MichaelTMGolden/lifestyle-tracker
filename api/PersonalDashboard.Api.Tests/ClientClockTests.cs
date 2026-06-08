using PersonalDashboard.Api;
using Xunit;

namespace PersonalDashboard.Api.Tests;

public class ClientClockTests
{
    // Fixed instant: 2026-06-07 (Sunday) 20:03 UTC.
    private static readonly DateTime Utc = new(2026, 6, 7, 20, 3, 0, DateTimeKind.Utc);
    private static ClientClock At(int offsetMinutes) => new(offsetMinutes) { UtcNow = Utc };

    [Fact]
    public void Utc_offset_zero_matches_utc()
    {
        var c = At(0);
        Assert.Equal(new DateOnly(2026, 6, 7), c.Today);
        Assert.Equal(DayOfWeek.Sunday, c.DayOfWeek);
        Assert.Equal(20 * 60 + 3, c.NowMinutes);
        // local midnight today, as a UTC instant, is 00:00Z
        Assert.Equal(new DateTimeOffset(2026, 6, 7, 0, 0, 0, TimeSpan.Zero), c.TodayStartUtc);
        Assert.Equal(TimeSpan.FromDays(1), c.TodayEndUtc - c.TodayStartUtc);
    }

    [Fact]
    public void Ahead_of_utc_plus_one_hour()
    {
        // getTimezoneOffset() for UTC+1 is -60 (UTC minus local). Local = 21:03.
        var c = At(-60);
        Assert.Equal(new DateOnly(2026, 6, 7), c.Today);
        Assert.Equal(21 * 60 + 3, c.NowMinutes);
        // local midnight (00:00 +01:00) == 23:00Z the previous day
        Assert.Equal(new DateTimeOffset(2026, 6, 6, 23, 0, 0, TimeSpan.Zero), c.TodayStartUtc);
    }

    [Fact]
    public void Behind_utc_crosses_day_boundary_backwards()
    {
        // UTC-5 (e.g. US East) → offset +300. Local = 15:03, still Jun 7.
        var c = At(300);
        Assert.Equal(new DateOnly(2026, 6, 7), c.Today);
        Assert.Equal(15 * 60 + 3, c.NowMinutes);
        // local midnight (00:00 -05:00) == 05:00Z
        Assert.Equal(new DateTimeOffset(2026, 6, 7, 5, 0, 0, TimeSpan.Zero), c.TodayStartUtc);
    }

    [Fact]
    public void Day_boundary_far_ahead_rolls_to_next_local_day()
    {
        // UTC+12 → offset -720. 20:03Z is 08:03 the NEXT local day (Jun 8, Monday).
        var c = At(-720);
        Assert.Equal(new DateOnly(2026, 6, 8), c.Today);
        Assert.Equal(DayOfWeek.Monday, c.DayOfWeek);
        Assert.Equal(8 * 60 + 3, c.NowMinutes);
        Assert.True(c.TodayStartUtc <= new DateTimeOffset(Utc) && new DateTimeOffset(Utc) < c.TodayEndUtc);
    }
}
