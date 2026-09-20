using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using PersonalDashboard.Api.Data;
using PersonalDashboard.Api.Domain;
using PersonalDashboard.Api.Endpoints;
using Xunit;

namespace PersonalDashboard.Api.Tests;

public class DailyPlanningTests
{
    private static HttpRequest Request() => new DefaultHttpContext().Request;
    private static DateOnly Today => DateOnly.FromDateTime(DateTime.UtcNow);
    private static int? Status(IResult result) => ((IStatusCodeHttpResult)result).StatusCode;

    private static AppDbContext Database() => new(new DbContextOptionsBuilder<AppDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString())
        .ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning)).Options);

    [Fact]
    public async Task Pending_preserves_only_unfinished_past_items_and_carry_moves_same_row()
    {
        await using var db = Database();
        var old = new DailyTodo { Title = "Still useful", Date = Today.AddDays(-2) };
        db.DailyTodos.AddRange(old,
            new DailyTodo { Title = "Finished", Date = Today.AddDays(-1), Done = true },
            new DailyTodo { Title = "Today", Date = Today, SortOrder = 3 });
        await db.SaveChangesAsync();

        Assert.Equal(old.Id, Assert.Single(await DailyPlanningEndpoints.Pending(db, Request())).Id);
        Assert.Equal(200, Status(await DailyPlanningEndpoints.Carry(old.Id, new(Today), db, Request())));
        Assert.Empty(await DailyPlanningEndpoints.Pending(db, Request()));
        Assert.Equal(Today, old.Date);
        Assert.Equal(4, old.SortOrder);
        Assert.Equal(3, await db.DailyTodos.CountAsync());
        // A retried carry cannot duplicate the item or move it repeatedly in the list.
        await DailyPlanningEndpoints.Carry(old.Id, new(Today), db, Request());
        Assert.Equal(4, old.SortOrder);
        Assert.Equal(3, await db.DailyTodos.CountAsync());
    }

    [Fact]
    public async Task Promote_replaces_daily_item_without_duplicates()
    {
        await using var db = Database();
        var item = new DailyTodo { Title = "Book rehearsal", Date = Today.AddDays(-1) };
        db.DailyTodos.Add(item);
        await db.SaveChangesAsync();

        Assert.Equal(200, Status(await DailyPlanningEndpoints.Promote(item.Id, db)));
        var task = Assert.Single(await db.TodoItems.ToListAsync());
        Assert.Equal("Book rehearsal", task.Title);
        Assert.Contains(item.Date.ToString("yyyy-MM-dd"), task.Notes);
        Assert.Empty(await db.DailyTodos.ToListAsync());
        Assert.Equal(404, Status(await DailyPlanningEndpoints.Promote(item.Id, db)));
        Assert.Single(await db.TodoItems.ToListAsync());
    }

    [Fact]
    public async Task Three_priorities_per_day_is_enforced_without_changing_due_date()
    {
        await using var db = Database();
        for (var i = 0; i < 3; i++) db.TodoItems.Add(new TodoItem { Title = $"Priority {i}", PlannedFor = Today, IsPriority = true });
        var due = DateTimeOffset.UtcNow.AddDays(14);
        var candidate = new TodoItem { Title = "Fourth", DueAt = due };
        db.TodoItems.Add(candidate);
        await db.SaveChangesAsync();

        Assert.Equal(409, Status(await DailyPlanningEndpoints.Plan(candidate.Id, new(Today, true), db, Request())));
        Assert.Null(candidate.PlannedFor);
        Assert.False(candidate.IsPriority);
        Assert.Equal(200, Status(await DailyPlanningEndpoints.Plan(candidate.Id, new(Today, false), db, Request())));
        Assert.Equal(due, candidate.DueAt);
        Assert.Equal(200, Status(await DailyPlanningEndpoints.Plan(candidate.Id, new(Today.AddDays(1), true), db, Request())));
        Assert.True(candidate.IsPriority);
        Assert.Equal(due, candidate.DueAt);
    }

    [Fact]
    public async Task Invalid_plans_and_completed_daily_items_are_not_changed()
    {
        await using var db = Database();
        var daily = new DailyTodo { Title = "Done", Date = Today.AddDays(-1), Done = true };
        var task = new TodoItem { Title = "Open" };
        db.AddRange(daily, task);
        await db.SaveChangesAsync();
        Assert.Equal(400, Status(await DailyPlanningEndpoints.Carry(daily.Id, new(Today), db, Request())));
        Assert.Equal(400, Status(await DailyPlanningEndpoints.Promote(daily.Id, db)));
        Assert.Equal(400, Status(await DailyPlanningEndpoints.Plan(task.Id, new(null, true), db, Request())));
        Assert.Equal(400, Status(await DailyPlanningEndpoints.Plan(task.Id, new(Today.AddDays(-1), false), db, Request())));
        Assert.True(daily.Done);
        Assert.Null(task.PlannedFor);
    }
}
