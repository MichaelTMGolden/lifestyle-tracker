using Microsoft.EntityFrameworkCore;
using PersonalDashboard.Api.Data;
using PersonalDashboard.Api.Domain;

namespace PersonalDashboard.Api.Endpoints;

public record CarryDailyInput(DateOnly Date);
public record TaskPlanInput(DateOnly? Date, bool IsPriority);

public static class DailyPlanningEndpoints
{
    public static RouteGroupBuilder MapDailyPlanningEndpoints(this RouteGroupBuilder api)
    {
        api.MapGet("/daily-todos/pending", Pending);
        api.MapPost("/daily-todos/{id:long}/carry", Carry);
        api.MapPost("/daily-todos/{id:long}/promote", Promote);
        api.MapPut("/todos/{id:long}/plan", Plan);
        return api;
    }

    public static async Task<List<DailyTodo>> Pending(AppDbContext db, HttpRequest req)
    {
        var today = ClientClock.From(req).Today;
        return await db.DailyTodos.AsNoTracking().Where(t => !t.Done && t.Date < today)
            .OrderBy(t => t.Date).ThenBy(t => t.SortOrder).ThenBy(t => t.Id).ToListAsync();
    }

    public static async Task<IResult> Carry(long id, CarryDailyInput input, AppDbContext db, HttpRequest req)
    {
        if (input.Date < ClientClock.From(req).Today)
            return Results.BadRequest(new { error = "Choose today or a future date." });
        var item = await db.DailyTodos.FindAsync(id);
        if (item is null) return Results.NotFound();
        if (item.Done) return Results.BadRequest(new { error = "This to-do is already complete." });
        if (item.Date != input.Date)
        {
            item.SortOrder = (await db.DailyTodos.Where(t => t.Date == input.Date).MaxAsync(t => (int?)t.SortOrder) ?? 0) + 1;
            item.Date = input.Date;
            await db.SaveChangesAsync();
        }
        return Results.Ok(item);
    }

    // One transaction preserves the daily item unless its replacement task is saved.
    public static async Task<IResult> Promote(long id, AppDbContext db)
    {
        await using var transaction = await db.Database.BeginTransactionAsync();
        var item = await db.DailyTodos.FindAsync(id);
        if (item is null) return Results.NotFound();
        if (item.Done) return Results.BadRequest(new { error = "This to-do is already complete." });
        var task = new TodoItem
        {
            Title = item.Title, CreatedAt = DateTimeOffset.UtcNow,
            Notes = $"Carried forward from daily plan for {item.Date:yyyy-MM-dd}.",
            SortOrder = (await db.TodoItems.MaxAsync(t => (int?)t.SortOrder) ?? 0) + 1,
        };
        db.TodoItems.Add(task);
        db.DailyTodos.Remove(item);
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
        return Results.Ok(task);
    }

    public static async Task<IResult> Plan(long id, TaskPlanInput input, AppDbContext db, HttpRequest req)
    {
        if (input.Date is { } date && date < ClientClock.From(req).Today)
            return Results.BadRequest(new { error = "Choose today or a future date." });
        if (input.IsPriority && input.Date is null)
            return Results.BadRequest(new { error = "Choose a day for this priority." });
        await using var transaction = await db.Database.BeginTransactionAsync();
        // Serialize single-user planning updates across devices. The lock is
        // released on commit/rollback, so count + update is one decision.
        if (db.Database.IsNpgsql())
            await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(71520901)");
        var task = await db.TodoItems.FindAsync(id);
        if (task is null) return Results.NotFound();
        if (task.CompletedAt is not null) return Results.BadRequest(new { error = "Reopen this task before planning it." });
        if (input.IsPriority && await db.TodoItems.CountAsync(t => t.Id != id && t.CompletedAt == null && t.IsPriority && t.PlannedFor == input.Date) >= 3)
            return Results.Conflict(new { error = "Three priorities are already pinned for that day. Unpin one first." });
        task.PlannedFor = input.Date;
        task.IsPriority = input.IsPriority;
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
        return Results.Ok(task);
    }
}
