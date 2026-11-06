using PersonalDashboard.Api.Endpoints;
using Xunit;

namespace PersonalDashboard.Api.Tests;

/// <summary>
/// Streaks are read from a bounded window of logs. These pin that the window
/// never changes a streak: it either matches the full-history count or says
/// the caller must fall back to full history.
/// </summary>
public class BoundedStreakTests
{
    private static readonly DateOnly Today = new(2026, 11, 7); // a Saturday

    private static IEnumerable<DateOnly> Run(DateOnly last, int days) =>
        Enumerable.Range(0, days).Select(i => last.AddDays(-i));

    [Fact]
    public void Daily_streak_inside_the_window_needs_no_fallback()
    {
        var dates = Run(Today, 20).ToList();
        var windowStart = Today.AddDays(-ApiEndpoints.StreakWindowDays);
        var result = HabitCadencePolicy.StreakWithin(dates.Where(d => d >= windowStart), Today, "daily", 1, windowStart);
        Assert.Equal((20, false), result);
        Assert.Equal(20, HabitCadencePolicy.Streak(dates, Today, "daily", 1));
    }

    [Fact]
    public void Daily_streak_reaching_the_window_edge_asks_for_full_history()
    {
        var windowStart = Today.AddDays(-30);
        var dates = Run(Today, 45).ToList(); // 45 days unbroken, window only sees 31
        var result = HabitCadencePolicy.StreakWithin(dates.Where(d => d >= windowStart), Today, "daily", 1, windowStart);
        Assert.True(result.MayExtendPastWindow);
        Assert.Equal(45, HabitCadencePolicy.Streak(dates, Today, "daily", 1));
    }

    [Fact]
    public void A_break_exactly_at_the_window_start_is_trusted()
    {
        var windowStart = Today.AddDays(-30);
        // Logged every day after the window start; the window start itself is missed.
        var dates = Run(Today, 30).ToList();
        var result = HabitCadencePolicy.StreakWithin(dates, Today, "daily", 1, windowStart);
        Assert.Equal((30, false), result);
    }

    [Fact]
    public void Unlogged_today_still_counts_back_from_yesterday()
    {
        var dates = Run(Today.AddDays(-1), 5).ToList();
        Assert.Equal((5, false), HabitCadencePolicy.StreakWithin(dates, Today, "daily", 1, Today.AddDays(-30)));
    }

    [Fact]
    public void Weekly_streak_that_straddles_the_window_asks_for_full_history()
    {
        var monday = HabitCadencePolicy.WeekStart(Today);
        // Three practice days in each of the last 10 weeks.
        var dates = Enumerable.Range(0, 10).SelectMany(w => new[] { 0, 2, 4 }.Select(d => monday.AddDays(-7 * w + d)))
            .Where(d => d <= Today).ToList();
        var full = HabitCadencePolicy.Streak(dates, Today, "weekly", 3);
        Assert.Equal(10, full);

        var windowStart = monday.AddDays(-7 * 5 + 3); // cuts into a week mid-way
        var bounded = HabitCadencePolicy.StreakWithin(dates.Where(d => d >= windowStart), Today, "weekly", 3, windowStart);
        Assert.True(bounded.MayExtendPastWindow);

        var wide = HabitCadencePolicy.StreakWithin(dates, Today, "weekly", 3, monday.AddDays(-7 * 20));
        Assert.Equal((10, false), wide);
    }

    [Fact]
    public void No_logs_is_a_zero_streak_without_fallback()
    {
        Assert.Equal((0, false), HabitCadencePolicy.StreakWithin([], Today, "daily", 1, Today.AddDays(-400)));
        Assert.Equal((0, false), HabitCadencePolicy.StreakWithin([], Today, "weekly", 3, Today.AddDays(-400)));
    }

    [Fact]
    public void Future_dated_logs_are_ignored()
    {
        var dates = new[] { Today.AddDays(1), Today.AddDays(2) };
        Assert.Equal(0, HabitCadencePolicy.Streak(dates, Today, "daily", 1));
    }
}
