using PersonalDashboard.Api.Endpoints;
using Xunit;

namespace PersonalDashboard.Api.Tests;

public class SkillProgressTests
{
    private static readonly DateOnly Today = new(2026, 9, 19);

    [Fact]
    public void Assessment_requires_evidence_and_rejects_unsafe_links()
    {
        Assert.NotNull(SkillProgressEndpoints.ValidateAssessment(new(Today, 4, null, " "), Today));
        Assert.NotNull(SkillProgressEndpoints.ValidateAssessment(new(Today, 4, "javascript:alert(1)", "notes"), Today));
        Assert.Null(SkillProgressEndpoints.ValidateAssessment(new(Today, 4, "https://example.com/recording", null), Today));
        Assert.Null(SkillProgressEndpoints.ValidateAssessment(new(Today, 0, null, "Baseline: cannot yet perform this exercise."), Today));
    }

    [Fact]
    public void Assessment_rejects_future_dates_and_invalid_scores()
    {
        Assert.NotNull(SkillProgressEndpoints.ValidateAssessment(new(Today.AddDays(1), 5, null, "notes"), Today));
        foreach (var score in new[] { -1d, 11d, double.NaN, double.PositiveInfinity })
            Assert.NotNull(SkillProgressEndpoints.ValidateAssessment(new(Today, score, null, "notes"), Today));
    }

    [Fact]
    public void Weekly_streak_keeps_rest_days_and_pending_current_week()
    {
        var monday = HabitCadencePolicy.WeekStart(Today);
        var dates = new[] { monday.AddDays(-7), monday.AddDays(-5), monday.AddDays(-3), monday };
        Assert.Equal(1, HabitCadencePolicy.Streak(dates, Today, "weekly", 3));
        Assert.Equal(2, HabitCadencePolicy.Streak(dates.Concat(new[] { monday.AddDays(1), monday.AddDays(3) }), Today, "weekly", 3));
        Assert.Equal(0, HabitCadencePolicy.Streak(dates.Where(d => d != monday.AddDays(-3)), Today, "weekly", 3));
    }

    [Fact]
    public void Repeated_same_day_and_future_dates_do_not_inflate_weekly_progress()
    {
        var monday = HabitCadencePolicy.WeekStart(Today);
        var dates = new[] { monday, monday, Today.AddDays(1) };
        Assert.Equal(0, HabitCadencePolicy.Streak(dates, Today, "weekly", 3));
        Assert.False(HabitCadencePolicy.IsValid("weekly", 8));
        Assert.False(HabitCadencePolicy.IsValid("daily", 2));
        Assert.True(HabitCadencePolicy.IsValid("weekly", 3));
    }
}
