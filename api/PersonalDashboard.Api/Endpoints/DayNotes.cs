using Microsoft.EntityFrameworkCore;
using PersonalDashboard.Api.Data;
using PersonalDashboard.Api.Domain;

namespace PersonalDashboard.Api.Endpoints;

public record DayNoteInput(int? Mood, string? Note);

/// <summary>The evening check-in: a mood (1–5) and one line about each day.</summary>
public static class DayNotes
{
    public const int MaxNote = 500;
    /// <summary>How far back a day can still be filled in (a missed evening or two).</summary>
    public const int MaxBackfillDays = 7;

    /// <summary>Saves or clears a day's check-in. Returns an error message, or null.</summary>
    public static async Task<string?> SaveAsync(AppDbContext db, DateOnly date, DayNoteInput input, DateOnly today, DateTimeOffset now)
    {
        if (date > today || date < today.AddDays(-MaxBackfillDays)) return $"date must be within the last {MaxBackfillDays} days";
        if (input.Mood is < 1 or > 5) return "mood must be 1 to 5";
        var note = string.IsNullOrWhiteSpace(input.Note) ? null : input.Note.Trim();
        if (note is { Length: > MaxNote }) return $"note must be {MaxNote} characters or fewer";

        var row = await db.DayNotes.FirstOrDefaultAsync(d => d.Date == date);
        if (input.Mood is null && note is null)
        {
            if (row is not null) { db.DayNotes.Remove(row); await db.SaveChangesAsync(); }
            return null;
        }
        if (row is null) db.DayNotes.Add(row = new DayNote { Date = date });
        row.Mood = input.Mood; row.Note = note; row.UpdatedAt = now;
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateException) when (db.Database.IsNpgsql())
        {
            // Another device saved the same day first: write over it.
            db.ChangeTracker.Clear();
            var existing = await db.DayNotes.FirstAsync(d => d.Date == date);
            existing.Mood = input.Mood; existing.Note = note; existing.UpdatedAt = now;
            await db.SaveChangesAsync();
        }
        return null;
    }

    internal static void Map(RouteGroupBuilder api)
    {
        api.MapGet("/day-notes", async (AppDbContext db, HttpRequest req, int days = 371) =>
        {
            var since = ClientClock.From(req).Today.AddDays(-Math.Clamp(days, 1, 800));
            return await db.DayNotes.AsNoTracking().Where(d => d.Date >= since).OrderBy(d => d.Date)
                .Select(d => new { d.Date, d.Mood, d.Note }).ToListAsync();
        });

        api.MapPut("/day-notes/{date}", async (DateOnly date, DayNoteInput body, AppDbContext db, HttpRequest req) =>
        {
            var error = await SaveAsync(db, date, body, ClientClock.From(req).Today, DateTimeOffset.UtcNow);
            return error is null ? Results.NoContent() : Results.BadRequest(new { message = error });
        });
    }
}
