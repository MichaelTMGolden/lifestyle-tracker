using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using PersonalDashboard.Api.Data;
using PersonalDashboard.Api.Domain;
using PersonalDashboard.Api.Endpoints;
using Xunit;

namespace PersonalDashboard.Api.Tests;

/// <summary>Writes that offline taps replay: a repeat must never change the result.</summary>
public class HabitWritesTests
{
    private static readonly DateOnly Today = new(2026, 11, 8);

    private static async Task<(AppDbContext db, int habitId)> Database()
    {
        var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning)).Options);
        var habit = new Habit { Name = "Guitar", TracksTime = true };
        db.Habits.Add(habit);
        await db.SaveChangesAsync();
        return (db, habit.Id);
    }

    private static Task<HabitLog?> Log(AppDbContext db, int id, DateOnly date) =>
        db.HabitLogs.AsNoTracking().FirstOrDefaultAsync(l => l.HabitId == id && l.Date == date);

    [Fact]
    public async Task Replaying_the_same_request_adds_minutes_once()
    {
        var (db, id) = await Database();
        var request = Guid.NewGuid();
        Assert.Equal(HabitWrites.Outcome.Applied, await HabitWrites.AddMinutesAsync(db, id, Today, 25, request, Today));
        Assert.Equal(HabitWrites.Outcome.Duplicate, await HabitWrites.AddMinutesAsync(db, id, Today, 25, request, Today));
        Assert.Equal(25, (await Log(db, id, Today))!.Minutes);
    }

    [Fact]
    public async Task Different_requests_add_up_and_no_id_keeps_the_old_behaviour()
    {
        var (db, id) = await Database();
        await HabitWrites.AddMinutesAsync(db, id, Today, 15, Guid.NewGuid(), Today);
        await HabitWrites.AddMinutesAsync(db, id, Today, 30, Guid.NewGuid(), Today);
        await HabitWrites.AddMinutesAsync(db, id, Today, 5, null, Today);
        var log = await Log(db, id, Today);
        Assert.Equal(50, log!.Minutes);
        Assert.True(log.Completed);
    }

    [Fact]
    public async Task A_queued_tap_lands_on_the_day_it_was_made()
    {
        var (db, id) = await Database();
        var yesterday = Today.AddDays(-1);
        await HabitWrites.AddMinutesAsync(db, id, yesterday, 20, Guid.NewGuid(), Today);
        Assert.Equal(20, (await Log(db, id, yesterday))!.Minutes);
        Assert.Null(await Log(db, id, Today));
    }

    [Fact]
    public async Task Dates_outside_the_backfill_window_or_in_the_future_are_refused()
    {
        var (db, id) = await Database();
        Assert.Equal(HabitWrites.Outcome.OutOfRange, await HabitWrites.AddMinutesAsync(db, id, Today.AddDays(1), 10, null, Today));
        Assert.Equal(HabitWrites.Outcome.OutOfRange, await HabitWrites.AddMinutesAsync(db, id, Today.AddDays(-HabitWrites.MaxBackfillDays - 1), 10, null, Today));
        Assert.Equal(HabitWrites.Outcome.OutOfRange, await HabitWrites.SetDoneAsync(db, id, Today.AddDays(1), true, Today));
        Assert.Equal(HabitWrites.Outcome.Applied, await HabitWrites.AddMinutesAsync(db, id, Today.AddDays(-HabitWrites.MaxBackfillDays), 10, null, Today));
    }

    [Fact]
    public async Task Set_done_is_idempotent_and_keeps_minutes()
    {
        var (db, id) = await Database();
        await HabitWrites.AddMinutesAsync(db, id, Today, 40, null, Today);
        await HabitWrites.SetDoneAsync(db, id, Today, false, Today);
        await HabitWrites.SetDoneAsync(db, id, Today, false, Today);
        var log = await Log(db, id, Today);
        Assert.False(log!.Completed);
        Assert.Equal(40, log.Minutes);
        await HabitWrites.SetDoneAsync(db, id, Today, true, Today);
        await HabitWrites.SetDoneAsync(db, id, Today, true, Today);
        Assert.True((await Log(db, id, Today))!.Completed);
    }

    [Fact]
    public async Task Not_done_on_an_empty_day_writes_nothing_and_unknown_habits_are_not_found()
    {
        var (db, id) = await Database();
        Assert.Equal(HabitWrites.Outcome.Applied, await HabitWrites.SetDoneAsync(db, id, Today, false, Today));
        Assert.Null(await Log(db, id, Today));
        Assert.Equal(HabitWrites.Outcome.NotFound, await HabitWrites.SetDoneAsync(db, id + 99, Today, true, Today));
        Assert.Equal(HabitWrites.Outcome.NotFound, await HabitWrites.AddMinutesAsync(db, id + 99, Today, 5, Guid.NewGuid(), Today));
    }

    [Fact]
    public async Task A_replay_after_its_entry_was_deleted_is_still_a_duplicate_and_recreates_nothing()
    {
        var (db, id) = await Database();
        var request = Guid.NewGuid();
        await HabitWrites.AddMinutesAsync(db, id, Today, 25, request, Today);
        db.HabitLogs.RemoveRange(db.HabitLogs.Where(l => l.HabitId == id));
        await db.SaveChangesAsync();
        Assert.Equal(HabitWrites.Outcome.Duplicate, await HabitWrites.AddMinutesAsync(db, id, Today, 25, request, Today));
        Assert.Null(await Log(db, id, Today));
    }
}
