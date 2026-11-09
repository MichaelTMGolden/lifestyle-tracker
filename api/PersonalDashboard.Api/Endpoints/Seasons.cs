using Microsoft.EntityFrameworkCore;
using PersonalDashboard.Api.Data;
using PersonalDashboard.Api.Domain;

namespace PersonalDashboard.Api.Endpoints;

public record SeasonInput(string? Name, List<int> HabitIds, DateOnly? EndsOn);

/// <summary>Starting, changing and ending seasons. Seasons never overlap.</summary>
public static class Seasons
{
    public const int MaxName = 80;

    /// <summary>The season covering <paramref name="day"/>, if any.</summary>
    public static Task<Season?> CurrentAsync(AppDbContext db, DateOnly day) =>
        db.Seasons.Where(s => s.StartsOn <= day && (s.EndsOn == null || s.EndsOn >= day))
            .OrderByDescending(s => s.StartsOn).FirstOrDefaultAsync();

    /// <summary>
    /// Sets the season from today: edits today's season if one started today,
    /// otherwise ends the current one yesterday and starts a new one. Returns an
    /// error message for bad input, or null.
    /// </summary>
    public static async Task<string?> SetAsync(AppDbContext db, SeasonInput input, DateOnly today)
    {
        var name = string.IsNullOrWhiteSpace(input.Name) ? null : input.Name.Trim();
        if (name is { Length: > MaxName }) return $"name must be {MaxName} characters or fewer";
        var asked = (input.HabitIds ?? new()).Distinct().ToList();
        if (input.EndsOn is { } end && end < today) return "the end date can't be in the past";
        // Habits deleted since the season was set are dropped, keeping the order given.
        var known = (await db.Habits.Where(h => asked.Contains(h.Id) && !h.Archived).Select(h => h.Id).ToListAsync()).ToHashSet();
        var ids = asked.Where(known.Contains).ToList();
        if (ids.Count == 0) return "pick at least one habit";

        await using var tx = await Serialize(db);

        // A season dated after today (a phone whose clock or time zone moved back)
        // would overlap this one: this one replaces it.
        db.Seasons.RemoveRange(await db.Seasons.Where(s => s.StartsOn > today).ToListAsync());
        var current = await CurrentAsync(db, today);
        if (current is not null && current.StartsOn == today)
        {
            current.Name = name; current.HabitIds = ids; current.EndsOn = input.EndsOn;
        }
        else
        {
            if (current is not null) current.EndsOn = today.AddDays(-1);
            db.Seasons.Add(new Season { Name = name, StartsOn = today, EndsOn = input.EndsOn, HabitIds = ids });
        }
        await db.SaveChangesAsync();
        await tx.CommitAsync();
        return null;
    }

    /// <summary>Ends the current season: from today every habit is in focus again.</summary>
    public static async Task EndAsync(AppDbContext db, DateOnly today)
    {
        await using var tx = await Serialize(db);
        if (await CurrentAsync(db, today) is { } current) await EndAsync(db, current, today);
        await tx.CommitAsync();
    }

    private static async Task EndAsync(AppDbContext db, Season current, DateOnly today)
    {
        if (current.StartsOn == today) db.Seasons.Remove(current);
        else current.EndsOn = today.AddDays(-1);
        await db.SaveChangesAsync();
    }

    /// <summary>Ends the current season if none of its habits exist any more.</summary>
    public static async Task EndIfEmptyAsync(AppDbContext db, DateOnly today)
    {
        // Under the lock, so a season another device saves meanwhile is never the one ended.
        await using var tx = await Serialize(db);
        var current = await CurrentAsync(db, today);
        if (current is null) return;
        var ids = current.HabitIds;
        if (await db.Habits.AnyAsync(h => ids.Contains(h.Id) && !h.Archived)) return;
        await EndAsync(db, current, today);
        await tx.CommitAsync();
    }

    /// <summary>
    /// One season change at a time (two devices saving together would otherwise
    /// both read the same current season and each add one, overlapping). The lock
    /// is held until the transaction ends.
    /// </summary>
    private static async Task<Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction> Serialize(AppDbContext db)
    {
        var tx = await db.Database.BeginTransactionAsync();
        if (db.Database.IsNpgsql()) await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(71520902)");
        return tx;
    }

    internal static void Map(RouteGroupBuilder api)
    {
        // Every season, newest first (the app works out which covers each day).
        api.MapGet("/seasons", async (AppDbContext db) =>
            await db.Seasons.AsNoTracking().OrderByDescending(s => s.StartsOn)
                .Select(s => new { s.Id, s.Name, s.StartsOn, s.EndsOn, s.HabitIds }).ToListAsync());

        api.MapPut("/seasons/current", async (SeasonInput body, AppDbContext db, HttpRequest req) =>
        {
            var error = await SetAsync(db, body, ClientClock.From(req).Today);
            return error is null ? Results.NoContent() : Results.BadRequest(new { message = error });
        });

        api.MapDelete("/seasons/current", async (AppDbContext db, HttpRequest req) =>
        {
            await EndAsync(db, ClientClock.From(req).Today);
            return Results.NoContent();
        });
    }
}
