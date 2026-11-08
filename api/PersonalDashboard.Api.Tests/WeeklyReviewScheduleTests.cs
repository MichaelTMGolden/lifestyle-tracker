using PersonalDashboard.Api.Reviews;
using Xunit;

namespace PersonalDashboard.Api.Tests;

public class WeeklyReviewScheduleTests
{
    private static readonly DateOnly LastMonday = new(2026, 11, 2);

    [Fact]
    public void Not_before_monday_morning()
    {
        Assert.Null(WeeklyReviewSchedule.WeekDue(new DateTime(2026, 11, 9, 7, 59, 0), alreadyReviewed: false));
    }

    [Fact]
    public void Monday_from_eight_reviews_the_week_just_finished()
    {
        Assert.Equal(LastMonday, WeeklyReviewSchedule.WeekDue(new DateTime(2026, 11, 9, 8, 0, 0), false));
    }

    [Fact]
    public void Later_in_the_week_it_catches_up_if_it_was_missed()
    {
        Assert.Equal(LastMonday, WeeklyReviewSchedule.WeekDue(new DateTime(2026, 11, 12, 21, 0, 0), false));
        // Sunday still belongs to the week starting Monday 2 Nov, so the review due is the week before it.
        Assert.Equal(new DateOnly(2026, 10, 26), WeeklyReviewSchedule.WeekDue(new DateTime(2026, 11, 8, 21, 0, 0), false));
    }

    [Fact]
    public void Nothing_once_written()
    {
        Assert.Null(WeeklyReviewSchedule.WeekDue(new DateTime(2026, 11, 9, 9, 0, 0), alreadyReviewed: true));
    }
}
