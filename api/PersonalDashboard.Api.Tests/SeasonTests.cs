using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using PersonalDashboard.Api.Data;
using PersonalDashboard.Api.Domain;
using PersonalDashboard.Api.Endpoints;
using Xunit;

namespace PersonalDashboard.Api.Tests;

/// <summary>Seasons never overlap, and history is kept when a new one starts.</summary>
public class SeasonTests
{
    private static readonly DateOnly Today = new(2026, 11, 9);

    private static async Task<(AppDbContext db, int a, int b)> Database()
    {
        var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning)).Options);
        var a = new Habit { Name = "Guitar" }; var b = new Habit { Name = "Reading" };
        db.Habits.AddRange(a, b);
        await db.SaveChangesAsync();
        return (db, a.Id, b.Id);
    }

    [Fact]
    public async Task A_new_season_ends_the_last_one_yesterday()
    {
        var (db, a, b) = await Database();
        Assert.Null(await Seasons.SetAsync(db, new("Autumn", [a], null), Today.AddDays(-30)));
        Assert.Null(await Seasons.SetAsync(db, new("Winter", [b], Today.AddDays(90)), Today));
        var all = await db.Seasons.AsNoTracking().OrderBy(s => s.StartsOn).ToListAsync();
        Assert.Equal(2, all.Count);
        Assert.Equal(Today.AddDays(-1), all[0].EndsOn);
        Assert.Equal([b], all[1].HabitIds);
        Assert.Equal("Winter", (await Seasons.CurrentAsync(db, Today))!.Name);
    }

    [Fact]
    public async Task Changing_a_season_on_the_day_it_started_edits_it()
    {
        var (db, a, b) = await Database();
        await Seasons.SetAsync(db, new(null, [a], null), Today);
        await Seasons.SetAsync(db, new("  Spring  ", [a, b, b], null), Today);
        var only = Assert.Single(await db.Seasons.AsNoTracking().ToListAsync());
        Assert.Equal("Spring", only.Name);
        Assert.Equal([a, b], only.HabitIds);
    }

    [Fact]
    public async Task Ending_keeps_history_and_frees_every_habit()
    {
        var (db, a, _) = await Database();
        await Seasons.SetAsync(db, new(null, [a], null), Today.AddDays(-10));
        await Seasons.EndAsync(db, Today);
        Assert.Null(await Seasons.CurrentAsync(db, Today));
        Assert.Equal(Today.AddDays(-1), (await db.Seasons.SingleAsync()).EndsOn);

        // Started and ended the same day: nothing to keep.
        await Seasons.SetAsync(db, new(null, [a], null), Today);
        await Seasons.EndAsync(db, Today);
        Assert.Single(await db.Seasons.ToListAsync());
    }

    [Fact]
    public async Task Bad_input_is_refused()
    {
        var (db, a, _) = await Database();
        Assert.NotNull(await Seasons.SetAsync(db, new(null, [], null), Today));
        Assert.NotNull(await Seasons.SetAsync(db, new(null, [999], null), Today));
        Assert.NotNull(await Seasons.SetAsync(db, new(null, [a], Today.AddDays(-1)), Today));
        Assert.NotNull(await Seasons.SetAsync(db, new(new string('x', 81), [a], null), Today));
        Assert.Empty(await db.Seasons.ToListAsync());
    }

    [Fact]
    public async Task Deleted_habits_are_dropped_not_refused()
    {
        var (db, a, b) = await Database();
        Assert.Null(await Seasons.SetAsync(db, new(null, [b, 999, a], null), Today));
        Assert.Equal([b, a], (await db.Seasons.SingleAsync()).HabitIds);
    }

    [Fact]
    public async Task Deleting_the_last_focus_habit_ends_the_season_but_keeps_history()
    {
        var (db, a, b) = await Database();
        await Seasons.SetAsync(db, new("Old", [b], Today.AddDays(-20)), Today.AddDays(-40)); // a past season
        await Seasons.SetAsync(db, new("Now", [a], null), Today.AddDays(-5));
        db.Habits.Remove(await db.Habits.SingleAsync(h => h.Id == a));
        await db.SaveChangesAsync();
        await Seasons.EndIfEmptyAsync(db, Today);
        Assert.Null(await Seasons.CurrentAsync(db, Today));
        var all = await db.Seasons.AsNoTracking().OrderBy(s => s.StartsOn).ToListAsync();
        Assert.Equal(2, all.Count);
        Assert.Equal(Today.AddDays(-1), all[1].EndsOn);
        Assert.Equal([b], all[0].HabitIds);
    }

    [Fact]
    public async Task A_season_that_ran_out_is_not_current()
    {
        var (db, a, _) = await Database();
        await Seasons.SetAsync(db, new(null, [a], Today.AddDays(-1)), Today.AddDays(-20));
        Assert.Null(await Seasons.CurrentAsync(db, Today));
    }
}
