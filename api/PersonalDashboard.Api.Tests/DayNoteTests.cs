using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using PersonalDashboard.Api.Data;
using PersonalDashboard.Api.Endpoints;
using Xunit;

namespace PersonalDashboard.Api.Tests;

public class DayNoteTests
{
    private static readonly DateOnly Today = new(2026, 11, 9);
    private static readonly DateTimeOffset Now = new(2026, 11, 9, 21, 0, 0, TimeSpan.Zero);

    private static AppDbContext Database() => new(new DbContextOptionsBuilder<AppDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString())
        .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning)).Options);

    [Fact]
    public async Task Saving_twice_updates_the_same_day()
    {
        var db = Database();
        Assert.Null(await DayNotes.SaveAsync(db, Today, new(3, "  long day  "), Today, Now));
        Assert.Null(await DayNotes.SaveAsync(db, Today, new(4, "better after guitar"), Today, Now));
        var row = Assert.Single(await db.DayNotes.ToListAsync());
        Assert.Equal(4, row.Mood);
        Assert.Equal("better after guitar", row.Note);
    }

    [Fact]
    public async Task Clearing_both_removes_the_day()
    {
        var db = Database();
        await DayNotes.SaveAsync(db, Today, new(2, null), Today, Now);
        Assert.Null(await DayNotes.SaveAsync(db, Today, new(null, "   "), Today, Now));
        Assert.Empty(await db.DayNotes.ToListAsync());
    }

    [Fact]
    public async Task Bad_input_is_refused()
    {
        var db = Database();
        Assert.NotNull(await DayNotes.SaveAsync(db, Today, new(6, null), Today, Now));
        Assert.NotNull(await DayNotes.SaveAsync(db, Today, new(0, null), Today, Now));
        Assert.NotNull(await DayNotes.SaveAsync(db, Today.AddDays(1), new(3, null), Today, Now));
        Assert.NotNull(await DayNotes.SaveAsync(db, Today.AddDays(-8), new(3, null), Today, Now));
        Assert.NotNull(await DayNotes.SaveAsync(db, Today, new(3, new string('x', 501)), Today, Now));
        Assert.Null(await DayNotes.SaveAsync(db, Today.AddDays(-7), new(3, null), Today, Now));
        Assert.Single(await db.DayNotes.ToListAsync());
    }
}
