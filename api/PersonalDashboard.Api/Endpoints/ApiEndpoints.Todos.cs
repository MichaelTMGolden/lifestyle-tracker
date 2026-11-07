using System.Net.Http.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.EntityFrameworkCore;
using PersonalDashboard.Api;
using PersonalDashboard.Api.Data;
using PersonalDashboard.Api.Domain;
using PersonalDashboard.Api.Alerts;
using PersonalDashboard.Api.Challenges;
using PersonalDashboard.Api.Garmin;
using PersonalDashboard.Api.Goals;
using PersonalDashboard.Api.Health;
using PersonalDashboard.Api.Integrations;
using PersonalDashboard.Api.Nutrition;
using PersonalDashboard.Api.Reviews;
using PersonalDashboard.Api.Schedule;

namespace PersonalDashboard.Api.Endpoints;

public record ReorderInput(List<long> Ids);

// Tasks and the daily checklist.
public static partial class ApiEndpoints
{
    internal static async Task<List<DailyTodo>> DailyTodosAsync(AppDbContext db, DateOnly date)
    {
        return await db.DailyTodos.AsNoTracking()
            .Where(t => t.Date == date)
            .OrderBy(t => t.Done).ThenBy(t => t.SortOrder).ThenBy(t => t.CreatedAt)
            .ToListAsync();
    }

    internal static Task<List<TodoItem>> TodosAsync(AppDbContext db) =>
        db.TodoItems.AsNoTracking()
            .OrderBy(t => t.CompletedAt != null).ThenBy(t => t.SortOrder)
            .ThenBy(t => t.Priority).ThenBy(t => t.DueAt).ToListAsync();

    private static void MapTodos(RouteGroupBuilder api)
    {
        // --- Todos ---
        api.MapGet("/todos", async (AppDbContext db) => await TodosAsync(db));

        api.MapPost("/todos", async (TodoItem input, AppDbContext db) =>
        {
            if (string.IsNullOrWhiteSpace(input.Title)) return Results.BadRequest(new { error = "A title is required." });
            input.Id = 0;
            input.Title = input.Title.Trim();
            input.CreatedAt = DateTimeOffset.UtcNow;
            input.CompletedAt = null;
            // Daily planning must go through the validated three-priority endpoint.
            input.PlannedFor = null;
            input.IsPriority = false;
            // New tasks land at the bottom of the manual order.
            input.SortOrder = (await db.TodoItems.MaxAsync(t => (int?)t.SortOrder) ?? 0) + 1;
            db.TodoItems.Add(input);
            await db.SaveChangesAsync();
            return Results.Created($"/api/todos/{input.Id}", input);
        });

        // Drag-to-reorder: client sends the open tasks' ids in their new order.
        api.MapPut("/todos/reorder", async (ReorderInput body, AppDbContext db) =>
        {
            var items = await db.TodoItems.Where(t => body.Ids.Contains(t.Id)).ToListAsync();
            var byId = items.ToDictionary(t => t.Id);
            for (var i = 0; i < body.Ids.Count; i++)
                if (byId.TryGetValue(body.Ids[i], out var t)) t.SortOrder = i;
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        api.MapPost("/todos/{id:long}/toggle", async (long id, AppDbContext db) =>
        {
            await using var transaction = await db.Database.BeginTransactionAsync();
            if (db.Database.IsNpgsql())
                await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(71520901)");
            var todo = await db.TodoItems.FindAsync(id);
            if (todo is null) return Results.NotFound();
            todo.CompletedAt = todo.CompletedAt is null ? DateTimeOffset.UtcNow : null;
            todo.IsPriority = false;
            await db.SaveChangesAsync();
            await transaction.CommitAsync();
            return Results.Ok(todo);
        });

        api.MapPut("/todos/{id:long}", async (long id, TodoItem input, AppDbContext db) =>
        {
            if (string.IsNullOrWhiteSpace(input.Title)) return Results.BadRequest(new { error = "A title is required." });
            var todo = await db.TodoItems.FindAsync(id);
            if (todo is null) return Results.NotFound();
            todo.Title = input.Title.Trim();
            todo.Notes = input.Notes;
            todo.Priority = input.Priority;
            todo.DueAt = input.DueAt;
            await db.SaveChangesAsync();
            return Results.Ok(todo);
        });

        api.MapDelete("/todos/{id:long}", async (long id, AppDbContext db) =>
        {
            var todo = await db.TodoItems.FindAsync(id);
            if (todo is null) return Results.NotFound();
            db.TodoItems.Remove(todo);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // --- Daily to-dos (date-scoped, retained until explicitly removed) ---
        // Pure read — no side effects (StrictMode/Promise.all/retries call this).
        api.MapGet("/daily-todos", async (AppDbContext db, HttpRequest req) =>
            // Optional ?date=YYYY-MM-DD to read another day (e.g. tomorrow's plan).
            await DailyTodosAsync(db, DateOnly.TryParse(req.Query["date"].FirstOrDefault(), out var d) ? d : ClientClock.From(req).Today));

        api.MapPost("/daily-todos", async (DailyTodo input, AppDbContext db, HttpRequest req) =>
        {
            var today = ClientClock.From(req).Today;
            if (string.IsNullOrWhiteSpace(input.Title)) return Results.BadRequest(new { error = "A title is required." });
            // Default to today; allow planning ahead (tomorrow). Never backdate.
            var date = input.Date >= today ? input.Date : today;
            var item = new DailyTodo
            {
                Date = date,
                Title = input.Title.Trim(),
                CreatedAt = DateTimeOffset.UtcNow,
                // New items land at the bottom of that day's manual order.
                SortOrder = (await db.DailyTodos.Where(t => t.Date == date).MaxAsync(t => (int?)t.SortOrder) ?? 0) + 1,
            };
            db.DailyTodos.Add(item);
            await db.SaveChangesAsync();
            return Results.Created($"/api/daily-todos/{item.Id}", item);
        });

        // Drag-to-reorder a day's to-dos: client sends ids in their new order.
        api.MapPut("/daily-todos/reorder", async (ReorderInput body, AppDbContext db) =>
        {
            var items = await db.DailyTodos.Where(t => body.Ids.Contains(t.Id)).ToListAsync();
            var byId = items.ToDictionary(t => t.Id);
            for (var i = 0; i < body.Ids.Count; i++)
                if (byId.TryGetValue(body.Ids[i], out var t)) t.SortOrder = i;
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        api.MapPost("/daily-todos/{id:long}/toggle", async (long id, AppDbContext db) =>
        {
            var item = await db.DailyTodos.FindAsync(id);
            if (item is null) return Results.NotFound();
            item.Done = !item.Done;
            await db.SaveChangesAsync();
            return Results.Ok(item);
        });

        api.MapDelete("/daily-todos/{id:long}", async (long id, AppDbContext db) =>
        {
            var item = await db.DailyTodos.FindAsync(id);
            if (item is null) return Results.NotFound();
            db.DailyTodos.Remove(item);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });
    }
}
