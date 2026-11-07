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

public record ChallengeInput(string Name, string Mode, int Target, string? Unit, bool? Strict, DateOnly? StartDate, DateOnly? TargetDate, string? ColorHex);
public record ChallengeDayInput(DateOnly Date);
public record ChallengeIncrementInput(double? Amount, string? Label, DateOnly? Date);

// Challenges.
public static partial class ApiEndpoints
{
    private static void MapChallenges(RouteGroupBuilder api)
    {
        // --- Challenges (finite, target-bound trackers; Daily chain or Quantity count) ---
        api.MapGet("/challenges", async (AppDbContext db, HttpRequest req) =>
        {
            var today = ClientClock.From(req).Today;
            var list = await db.Challenges.AsNoTracking().Include(c => c.Entries)
                .OrderBy(c => c.Archived).ThenByDescending(c => c.Id).ToListAsync();
            return Results.Ok(list.Select(c => ChallengeProgress.ToDto(c, today)));
        });

        api.MapGet("/challenges/{id:int}", async (int id, AppDbContext db, HttpRequest req) =>
        {
            var today = ClientClock.From(req).Today;
            var c = await db.Challenges.AsNoTracking().Include(x => x.Entries).FirstOrDefaultAsync(x => x.Id == id);
            return c is null ? Results.NotFound() : Results.Ok(ChallengeProgress.ToDto(c, today));
        });

        api.MapPost("/challenges", async (ChallengeInput input, AppDbContext db, HttpRequest req) =>
        {
            var today = ClientClock.From(req).Today;
            if (string.IsNullOrWhiteSpace(input.Name) || input.Target <= 0)
                return Results.BadRequest(new { error = "Name and a positive target are required." });
            if (!Enum.TryParse<ChallengeMode>(input.Mode, true, out var mode))
                return Results.BadRequest(new { error = "Mode must be Daily or Quantity." });

            var c = new Challenge
            {
                Name = input.Name.Trim(),
                Mode = mode,
                Target = input.Target,
                Unit = string.IsNullOrWhiteSpace(input.Unit) ? null : input.Unit.Trim(),
                Strict = mode == ChallengeMode.Daily && (input.Strict ?? false),
                StartDate = input.StartDate ?? today,
                TargetDate = input.TargetDate,
                ColorHex = input.ColorHex,
            };
            db.Challenges.Add(c);
            await db.SaveChangesAsync();
            return Results.Created($"/api/challenges/{c.Id}", ChallengeProgress.ToDto(c, today));
        });

        api.MapPut("/challenges/{id:int}", async (int id, ChallengeInput input, AppDbContext db, HttpRequest req) =>
        {
            var today = ClientClock.From(req).Today;
            var c = await db.Challenges.Include(x => x.Entries).FirstOrDefaultAsync(x => x.Id == id);
            if (c is null) return Results.NotFound();
            if (!string.IsNullOrWhiteSpace(input.Name)) c.Name = input.Name.Trim();
            if (input.Target > 0) c.Target = input.Target;
            c.Unit = string.IsNullOrWhiteSpace(input.Unit) ? null : input.Unit.Trim();
            if (c.Mode == ChallengeMode.Daily && input.Strict is bool strict) c.Strict = strict;
            if (input.StartDate is DateOnly sd) c.StartDate = sd;
            c.TargetDate = input.TargetDate;
            if (input.ColorHex is not null) c.ColorHex = input.ColorHex;
            ChallengeProgress.ApplyCompletion(c, today, DateTimeOffset.UtcNow);
            await db.SaveChangesAsync();
            return Results.Ok(ChallengeProgress.ToDto(c, today));
        });

        api.MapDelete("/challenges/{id:int}", async (int id, AppDbContext db) =>
        {
            var c = await db.Challenges.FindAsync(id);
            if (c is null) return Results.NotFound();
            db.Challenges.Remove(c);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // Daily: tick/untick a single day. Retroactive fill is allowed back to the
        // start date; future dates are rejected. Filling a gap repairs a strict chain.
        api.MapPost("/challenges/{id:int}/day/toggle", async (int id, ChallengeDayInput body, AppDbContext db, HttpRequest req) =>
        {
            var today = ClientClock.From(req).Today;
            var c = await db.Challenges.Include(x => x.Entries).FirstOrDefaultAsync(x => x.Id == id);
            if (c is null) return Results.NotFound();
            if (c.Mode != ChallengeMode.Daily) return Results.BadRequest(new { error = "Day toggle is only for Daily challenges." });
            if (body.Date > today) return Results.BadRequest(new { error = "Can't tick a future day." });
            if (body.Date < c.StartDate) return Results.BadRequest(new { error = "Day is before the challenge start." });

            var existing = c.Entries.Where(e => e.Date == body.Date).ToList();
            if (existing.Count > 0)
                // Clearing the day: removing from the parent collection deletes the
                // rows (required FK + cascade), and keeps c.Entries correct for recompute.
                foreach (var e in existing) c.Entries.Remove(e);
            else
                c.Entries.Add(new ChallengeEntry { ChallengeId = c.Id, Date = body.Date, Amount = 1 });

            ChallengeProgress.ApplyCompletion(c, today, DateTimeOffset.UtcNow);
            await db.SaveChangesAsync();
            return Results.Ok(ChallengeProgress.ToDto(c, today));
        });

        // Quantity: add one entry (default amount 1, today), optionally labelled.
        api.MapPost("/challenges/{id:int}/increment", async (int id, ChallengeIncrementInput body, AppDbContext db, HttpRequest req) =>
        {
            var today = ClientClock.From(req).Today;
            var c = await db.Challenges.Include(x => x.Entries).FirstOrDefaultAsync(x => x.Id == id);
            if (c is null) return Results.NotFound();
            if (c.Mode != ChallengeMode.Quantity) return Results.BadRequest(new { error = "Increment is only for Quantity challenges." });
            var date = body.Date ?? today;
            if (date > today) return Results.BadRequest(new { error = "Can't log a future date." });
            c.Entries.Add(new ChallengeEntry
            {
                ChallengeId = c.Id, Date = date,
                Amount = body.Amount is double a && a > 0 ? a : 1,
                Label = string.IsNullOrWhiteSpace(body.Label) ? null : body.Label.Trim(),
            });
            ChallengeProgress.ApplyCompletion(c, today, DateTimeOffset.UtcNow);
            await db.SaveChangesAsync();
            return Results.Ok(ChallengeProgress.ToDto(c, today));
        });

        // Remove a single logged entry (un-log a mistake/duplicate), then recompute its challenge.
        api.MapDelete("/challenges/entries/{entryId:int}", async (int entryId, AppDbContext db, HttpRequest req) =>
        {
            var today = ClientClock.From(req).Today;
            var entry = await db.ChallengeEntries.FindAsync(entryId);
            if (entry is null) return Results.NotFound();
            var c = await db.Challenges.Include(x => x.Entries).FirstOrDefaultAsync(x => x.Id == entry.ChallengeId);
            db.ChallengeEntries.Remove(entry);
            if (c is not null)
            {
                c.Entries = c.Entries.Where(e => e.Id != entryId).ToList();
                ChallengeProgress.ApplyCompletion(c, today, DateTimeOffset.UtcNow);
            }
            await db.SaveChangesAsync();
            return c is null ? Results.NoContent() : Results.Ok(ChallengeProgress.ToDto(c, today));
        });
    }
}
