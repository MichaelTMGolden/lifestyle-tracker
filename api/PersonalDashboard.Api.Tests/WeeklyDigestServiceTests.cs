using Microsoft.EntityFrameworkCore;
using PersonalDashboard.Api.Data;
using PersonalDashboard.Api.Domain;
using PersonalDashboard.Api.Reviews;
using Xunit;

namespace PersonalDashboard.Api.Tests;

// The digest builder is pure data — no network. These run against an in-memory DB.
public class WeeklyDigestServiceTests
{
    private static readonly DateOnly WeekStart = new(2026, 6, 15); // Monday
    private static readonly DateOnly Today = new(2026, 6, 17);     // Wednesday in that week

    private static AppDbContext NewDb() =>
        new(new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .EnableServiceProviderCaching(false)
            .Options);

    private static DateTimeOffset At(DateOnly d, int hour = 12) =>
        new(d.ToDateTime(new TimeOnly(hour, 0)), TimeSpan.Zero);

    [Fact]
    public async Task Computes_per_week_minutes_streak_and_metric_deltas()
    {
        using var db = NewDb();

        var guitar = new Habit { Name = "Guitar", TracksTime = true };
        db.Habits.Add(guitar);
        await db.SaveChangesAsync();

        // This week: Mon 30 + Tue 30 = 60. Last week: Wed 20.
        db.HabitLogs.AddRange(
            new HabitLog { HabitId = guitar.Id, Date = WeekStart, Minutes = 30, Completed = true },
            new HabitLog { HabitId = guitar.Id, Date = WeekStart.AddDays(1), Minutes = 30, Completed = true },
            new HabitLog { HabitId = guitar.Id, Date = WeekStart.AddDays(-5), Minutes = 20, Completed = true });

        db.Goals.Add(new Goal
        {
            Name = "100h Guitar", TargetMinutes = 6000, StartDate = new DateOnly(2026, 6, 1),
            Sources = new() { new GoalSource { HabitId = guitar.Id } },
        });

        // Resting HR: this week avg (50,52)=51; last week 54 → delta -3.
        var src = new DataSource { Name = "Garmin", Kind = SourceKind.Garmin };
        db.DataSources.Add(src);
        await db.SaveChangesAsync();
        db.MetricSamples.AddRange(
            new MetricSample { DataSourceId = src.Id, MetricKey = "resting_hr", RecordedAt = At(WeekStart), Value = 50, Unit = "bpm" },
            new MetricSample { DataSourceId = src.Id, MetricKey = "resting_hr", RecordedAt = At(WeekStart.AddDays(2)), Value = 52, Unit = "bpm" },
            new MetricSample { DataSourceId = src.Id, MetricKey = "resting_hr", RecordedAt = At(WeekStart.AddDays(-4)), Value = 54, Unit = "bpm" });
        await db.SaveChangesAsync();

        var digest = await WeeklyDigestService.BuildAsync(db, WeekStart, Today);

        var skill = Assert.Single(digest.Skills);
        Assert.Equal("Guitar", skill.Name);
        Assert.Equal(60, skill.MinutesThisWeek);
        Assert.Equal(20, skill.MinutesLastWeek);
        Assert.Equal(2, skill.DaysCompletedThisWeek);

        var goal = Assert.Single(digest.Goals);
        Assert.Equal("goal:" + db.Goals.Single().Id, goal.Id);
        Assert.Equal(60, goal.MinutesThisWeek);            // sum of feeder minutes this week
        Assert.Equal(20, goal.MinutesLastWeek);            // sum of feeder minutes last week
        Assert.Equal(1.3, goal.AccumulatedHours);          // 80 min (both weeks) since the 2026-06-01 start

        var rhr = Assert.Single(digest.Health, m => m.Key == "resting_hr");
        Assert.Equal(51, rhr.AvgThisWeek);
        Assert.Equal(54, rhr.AvgLastWeek);
        Assert.Equal(-3, rhr.Delta);
    }

    [Fact]
    public async Task Empty_week_produces_a_valid_digest()
    {
        using var db = NewDb();
        var digest = await WeeklyDigestService.BuildAsync(db, WeekStart, Today);
        Assert.Empty(digest.Goals);
        Assert.Empty(digest.Skills);
        Assert.Equal(0, digest.Tasks.CompletedThisWeek);
    }

    [Fact]
    public async Task Daily_snapshots_are_deduplicated_and_synthetic_history_is_not_evidence()
    {
        using var db = NewDb();
        var observed = new DataSource { Name = "Garmin", Kind = SourceKind.Garmin };
        var sample = new DataSource { Name = "Garmin (sample)", Kind = SourceKind.Garmin };
        var imported = new DataSource { Name = "Garmin (imported)", Kind = SourceKind.Garmin };
        db.DataSources.AddRange(observed, sample, imported);
        await db.SaveChangesAsync();
        void Add(DataSource source, string key, DateOnly date, double value, int hour) => db.MetricSamples.Add(
            new MetricSample { DataSourceId = source.Id, MetricKey = key, RecordedAt = At(date, hour), Value = value });

        for (var day = 0; day < 7; day++)
        {
            var date = WeekStart.AddDays(day);
            Add(observed, "calories_in", date, 1000, 8);
            Add(observed, "calories_in", date, 1800 + day * 20, 12);
            Add(sample, "calories_in", date, 9900, 20);
            Add(observed, "protein_g", date, 50, 8);
            Add(observed, "protein_g", date, day < 4 ? 160 : 120, 12);
            Add(sample, "protein_g", date, 500, 20);
            Add(observed, "resting_hr", date, 70, 8);
            Add(observed, "resting_hr", date, 50 + day, 12);
            Add(imported, "resting_hr", date, 88, 20);
            Add(imported, "stress_avg", date, 30, 12);
        }
        Add(observed, "resting_hr", WeekStart.AddDays(-1), 60, 12);
        await db.SaveChangesAsync();

        var digest = await WeeklyDigestService.BuildAsync(db, WeekStart, WeekStart.AddDays(7));
        Assert.Equal(7, digest.Nutrition.DaysLogged);
        Assert.Equal(4, digest.Nutrition.ProteinDaysOnTarget);
        Assert.Equal(1860, digest.Nutrition.AvgCalories);
        Assert.Equal(143, digest.Nutrition.AvgProtein);
        var heartRate = Assert.Single(digest.Health, metric => metric.Key == "resting_hr");
        Assert.Equal(53, heartRate.AvgThisWeek);
        Assert.Equal(60, heartRate.AvgLastWeek);
        Assert.Equal(-7, heartRate.Delta);
        Assert.DoesNotContain(digest.Health, metric => metric.Key == "stress_avg");
    }

    [Fact]
    public async Task A_week_with_only_sample_data_has_no_measured_health_or_nutrition()
    {
        using var db = NewDb();
        var source = new DataSource { Name = "Garmin (sample)", Kind = SourceKind.Garmin };
        db.DataSources.Add(source);
        await db.SaveChangesAsync();
        db.MetricSamples.AddRange(new[] { "steps", "calories_in", "protein_g" }.Select(key =>
            new MetricSample { DataSourceId = source.Id, MetricKey = key, RecordedAt = At(WeekStart), Value = 200 }));
        await db.SaveChangesAsync();

        var digest = await WeeklyDigestService.BuildAsync(db, WeekStart, Today);
        Assert.Empty(digest.Health);
        Assert.Null(digest.Nutrition.AvgCalories);
        Assert.Null(digest.Nutrition.AvgProtein);
        Assert.Equal(0, digest.Nutrition.DaysLogged);
        Assert.Equal(0, digest.Nutrition.ProteinDaysOnTarget);
    }
}
