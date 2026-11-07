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

public record GoalInput(string Name, int TargetHours, string? ColorHex, DateOnly? StartDate, List<int>? SourceHabitIds, DateOnly? TargetDate = null, bool CountAllTime = false);

// Hour goals fed by habits.
public static partial class ApiEndpoints
{
    private static void MapGoals(RouteGroupBuilder api)
    {
        // --- Goals (hour targets fed by one or more skills) ---
        api.MapGet("/goals", (AppDbContext db, HttpRequest req) =>
            GoalPacingService.ComputeAsync(db, ClientClock.From(req).Today));

        api.MapPost("/goals", async (GoalInput input, AppDbContext db, HttpRequest req) =>
        {
            var goal = new Goal
            {
                Name = input.Name,
                TargetMinutes = Math.Max(0, input.TargetHours) * 60,
                ColorHex = input.ColorHex,
                StartDate = input.StartDate ?? ClientClock.From(req).Today,  // default: created-on date
                TargetDate = input.TargetDate,
                CountAllTime = input.CountAllTime,
                Sources = (input.SourceHabitIds ?? new())
                    .Distinct().Select(hid => new GoalSource { HabitId = hid }).ToList(),
            };
            db.Goals.Add(goal);
            await db.SaveChangesAsync();
            return Results.Created($"/api/goals/{goal.Id}", new { goal.Id });
        });

        api.MapPut("/goals/{id:int}", async (int id, GoalInput input, AppDbContext db) =>
        {
            var goal = await db.Goals.Include(g => g.Sources).FirstOrDefaultAsync(g => g.Id == id);
            if (goal is null) return Results.NotFound();

            goal.Name = input.Name;
            goal.TargetMinutes = Math.Max(0, input.TargetHours) * 60;
            goal.ColorHex = input.ColorHex;
            goal.StartDate = input.StartDate;
            goal.TargetDate = input.TargetDate;
            goal.CountAllTime = input.CountAllTime;

            db.GoalSources.RemoveRange(goal.Sources);
            goal.Sources = (input.SourceHabitIds ?? new())
                .Distinct().Select(hid => new GoalSource { GoalId = goal.Id, HabitId = hid }).ToList();

            await db.SaveChangesAsync();
            return Results.Ok(new { goal.Id });
        });

        api.MapDelete("/goals/{id:int}", async (int id, AppDbContext db) =>
        {
            var goal = await db.Goals.FindAsync(id);
            if (goal is null) return Results.NotFound();
            db.Goals.Remove(goal);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // Retire a completed goal into the Completed section (and back).
        api.MapPut("/goals/{id:int}/archive", async (int id, AppDbContext db, HttpRequest req) =>
        {
            var goal = await db.Goals.FindAsync(id);
            if (goal is null) return Results.NotFound();
            goal.Archived = true;
            goal.CompletedOn ??= ClientClock.From(req).Today; // retiring effectively marks it done
            await db.SaveChangesAsync();
            return Results.Ok(new { goal.Id, goal.Archived });
        });

        api.MapPut("/goals/{id:int}/unarchive", async (int id, AppDbContext db) =>
        {
            var goal = await db.Goals.FindAsync(id);
            if (goal is null) return Results.NotFound();
            goal.Archived = false;
            await db.SaveChangesAsync();
            return Results.Ok(new { goal.Id, goal.Archived });
        });
    }
}
