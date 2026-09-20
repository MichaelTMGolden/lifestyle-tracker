using Microsoft.EntityFrameworkCore;
using PersonalDashboard.Api.Alerts;
using PersonalDashboard.Api.Data;
using PersonalDashboard.Api.Domain;
using Xunit;

namespace PersonalDashboard.Api.Tests;

public class HabitInactivityTests
{
    private static readonly DateOnly Today = new(2026, 9, 19);
    private static AppDbContext NewDb() => new(new DbContextOptionsBuilder<AppDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString()).EnableServiceProviderCaching(false).Options);

    [Fact]
    public async Task Weekly_practice_does_not_create_daily_inactivity_alerts()
    {
        using var db = NewDb();
        db.Habits.Add(new Habit { Name = "Weekly studio", TracksTime = true, Cadence = "weekly", TargetPerPeriod = 1,
            Logs = new() { new HabitLog { Date = Today.AddDays(-4), Completed = true, Minutes = 60 } } });
        await db.SaveChangesAsync();
        var alerts = await new StreakBreakDetector().DetectAsync(new(db, Today, DateTimeOffset.UtcNow));
        Assert.DoesNotContain(alerts, alert => alert.Kind == "Inactivity");
    }

    [Fact]
    public async Task Weekly_session_does_not_mask_inactive_daily_practice()
    {
        using var db = NewDb();
        db.Habits.AddRange(
            new Habit { Name = "Daily guitar", TracksTime = true, Cadence = "daily",
                Logs = new() { new HabitLog { Date = Today.AddDays(-4), Completed = true, Minutes = 30 } } },
            new Habit { Name = "Weekly studio", TracksTime = true, Cadence = "weekly", TargetPerPeriod = 1,
                Logs = new() { new HabitLog { Date = Today, Completed = true, Minutes = 60 } } });
        await db.SaveChangesAsync();
        var alerts = await new StreakBreakDetector().DetectAsync(new(db, Today, DateTimeOffset.UtcNow));
        var alert = Assert.Single(alerts, a => a.Kind == "Inactivity");
        Assert.Equal(4, alert.Value);
        Assert.Contains("daily timed skills", alert.Detail);
    }
}
