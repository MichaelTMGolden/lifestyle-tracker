using PersonalDashboard.Api.Endpoints;
using Xunit;

namespace PersonalDashboard.Api.Tests;

public class BestStreakTests
{
    private static readonly DateOnly Today = new(2026, 11, 7); // a Saturday
    private static readonly DateOnly From = Today.AddDays(-400);

    private static IEnumerable<DateOnly> Run(DateOnly last, int days) =>
        Enumerable.Range(0, days).Select(i => last.AddDays(-i));

    [Fact]
    public void Daily_best_is_the_longest_past_run()
    {
        var dates = Run(Today.AddDays(-50), 12).Concat(Run(Today, 4)).ToList();
        Assert.Equal(12, HabitCadencePolicy.BestStreak(dates, Today, "daily", 1, From));
        Assert.Equal(4, HabitCadencePolicy.Streak(dates, Today, "daily", 1));
    }

    [Fact]
    public void Unlogged_today_does_not_break_the_current_run()
    {
        var dates = Run(Today.AddDays(-1), 6).ToList();
        Assert.Equal(6, HabitCadencePolicy.BestStreak(dates, Today, "daily", 1, From));
    }

    [Fact]
    public void Weekly_best_counts_met_weeks_and_ignores_the_unfinished_week()
    {
        var monday = HabitCadencePolicy.WeekStart(Today);
        // Weeks 1–5 back: 3 days each (met). Week 6 back: 1 day (missed). Weeks 7–8 back: met.
        var dates = new List<DateOnly>();
        foreach (var w in new[] { 1, 2, 3, 4, 5, 7, 8 })
            dates.AddRange(new[] { 0, 2, 4 }.Select(d => monday.AddDays(-7 * w + d)));
        dates.Add(monday.AddDays(-7 * 6));
        dates.Add(monday); // this week: 1 of 3 so far
        Assert.Equal(5, HabitCadencePolicy.BestStreak(dates, Today, "weekly", 3, From));
    }

    [Fact]
    public void Runs_before_the_range_are_not_counted()
    {
        var dates = Run(Today.AddDays(-30), 20).ToList();
        Assert.Equal(10, HabitCadencePolicy.BestStreak(dates, Today, "daily", 1, Today.AddDays(-39)));
    }

    [Fact]
    public void No_logs_is_zero()
    {
        Assert.Equal(0, HabitCadencePolicy.BestStreak([], Today, "daily", 1, From));
        Assert.Equal(0, HabitCadencePolicy.BestStreak([], Today, "weekly", 3, From));
    }
}
