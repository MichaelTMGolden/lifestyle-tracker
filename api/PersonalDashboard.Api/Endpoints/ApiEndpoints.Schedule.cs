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

public record ScheduleNoteInput(string? Details);

// The weekly schedule, today's schedule and the calendar.
public static partial class ApiEndpoints
{
    // --- schedule default / auto-revert ---
    private static async Task ApplyScheduleBlocksAsync(AppDbContext db, List<ScheduleBlock> blocks)
    {
        await db.ScheduleBlocks.ExecuteDeleteAsync();
        db.ScheduleBlocks.AddRange(blocks);
        await db.SaveChangesAsync();
    }

    /// <summary>If a temporary schedule's revert date has arrived, restore the saved default.</summary>
    private static async Task EnsureScheduleCurrentAsync(AppDbContext db, DateOnly today)
    {
        var revertRaw = await GetSecretAsync(db, "schedule.revertOn");
        if (revertRaw is null || !DateOnly.TryParse(revertRaw, out var revert) || today < revert) return;
        var def = await GetSecretAsync(db, "schedule.default");
        await DeleteSecretAsync(db, "schedule.revertOn");
        if (def is null) return;
        try
        {
            var blocks = ScheduleParser.Parse(def);
            if (blocks.Count > 0) await ApplyScheduleBlocksAsync(db, blocks);
        }
        catch { /* leave the current schedule if the saved default won't parse */ }
    }

    internal static async Task<object> ScheduleTodayAsync(AppDbContext db, ClientClock clock)
    {
        await EnsureScheduleCurrentAsync(db, clock.Today);
        var todayStart = clock.TodayStartUtc;
        var todayEnd = clock.TodayEndUtc;
        var dow = clock.DayOfWeek;

        var blocks = await db.ScheduleBlocks.AsNoTracking()
            .Where(b => b.Day == dow)
            .OrderBy(b => b.StartMinutes)
            .ToListAsync();

        var events = await db.CalendarEvents.AsNoTracking()
            .Where(e => e.StartsAt < todayEnd && e.EndsAt > todayStart)
            .OrderBy(e => e.StartsAt)
            .ToListAsync();

        // Calendar events are returned as their own list (rendered once each,
        // spanning their range). A block carries only an `overlapped` flag so
        // the UI can dim it — we never copy event titles onto blocks.
        var annotated = blocks.Select(b =>
        {
            var overlapped = SchedulePrecedence.IsOverlapped(b.StartMinutes, b.DurationMinutes, todayStart, events);
            return new
            {
                b.Id, b.StartMinutes, b.DurationMinutes, b.Activity, b.Notes,
                category = b.Category.ToString(), b.Protected,
                overlapped,
            };
        }).ToList();

        return new { day = dow.ToString(), blocks = annotated, events };
    }

    private static void MapSchedule(RouteGroupBuilder api)
    {
        // --- Weekly schedule (recurring template) ---
        api.MapGet("/schedule/week", async (AppDbContext db, HttpRequest req) =>
        {
            var today = ClientClock.From(req).Today;
            await EnsureScheduleCurrentAsync(db, today);
            var weekStart = WeekStartOf(today);
            var blocks = await db.ScheduleBlocks.AsNoTracking()
                .OrderBy(b => b.Day).ThenBy(b => b.StartMinutes)
                .ToListAsync();
            // This week's one-off description overrides, keyed by block.
            var overrides = await db.ScheduleOverrides.AsNoTracking()
                .Where(o => o.WeekStart == weekStart)
                .ToDictionaryAsync(o => o.ScheduleBlockId, o => o.Details);
            return blocks
                .GroupBy(b => b.Day)
                .OrderBy(g => ((int)g.Key + 6) % 7) // Monday-first
                .Select(g => new
                {
                    day = g.Key.ToString(),
                    blocks = g.Select(b => new
                    {
                        b.Id, b.StartMinutes, b.DurationMinutes, b.Activity, b.Notes, b.Details,
                        category = b.Category.ToString(), b.Protected,
                        weekOverride = overrides.TryGetValue(b.Id, out var d) ? d : null,
                    }),
                })
                .ToList();
        });

        // Set/clear a one-off description override for a block, for the current week only.
        api.MapPut("/schedule/blocks/{id:int}/week-note", async (int id, ScheduleNoteInput body, AppDbContext db, HttpRequest req) =>
        {
            if (!await db.ScheduleBlocks.AnyAsync(b => b.Id == id)) return Results.NotFound();
            var weekStart = WeekStartOf(ClientClock.From(req).Today);
            // Tidy up overrides from past weeks while we're here.
            await db.ScheduleOverrides.Where(o => o.WeekStart < weekStart).ExecuteDeleteAsync();

            var text = string.IsNullOrWhiteSpace(body?.Details) ? null : body!.Details!.Trim();
            var row = await db.ScheduleOverrides.FirstOrDefaultAsync(o => o.ScheduleBlockId == id && o.WeekStart == weekStart);
            if (text is null)
            {
                if (row is not null) db.ScheduleOverrides.Remove(row);
            }
            else if (row is null) db.ScheduleOverrides.Add(new ScheduleOverride { ScheduleBlockId = id, WeekStart = weekStart, Details = text });
            else row.Details = text;
            await db.SaveChangesAsync();
            return Results.Ok(new { id, weekOverride = text });
        });

        // --- Today's schedule with calendar precedence ---
        api.MapGet("/schedule/today", async (AppDbContext db, HttpRequest req) => Results.Ok(await ScheduleTodayAsync(db, ClientClock.From(req))));

        // Whether a default schedule is saved, and any pending auto-revert date.
        api.MapGet("/schedule/status", async (AppDbContext db) => Results.Ok(new
        {
            hasDefault = await GetSecretAsync(db, "schedule.default") is not null,
            revertOn = await GetSecretAsync(db, "schedule.revertOn"),
        }));

        // Replace the whole weekly schedule from an uploaded markdown timetable
        // (| Time | Duration | Activity | Notes | Details |). mode=default saves it as
        // the permanent default; otherwise it's temporary and reverts on revertOn (date).
        api.MapPost("/schedule/import", async (HttpRequest req, AppDbContext db) =>
        {
            string markdown, mode, revertOn;
            if (req.HasFormContentType)
            {
                var form = await req.ReadFormAsync();
                var file = form.Files.FirstOrDefault();
                if (file is null || file.Length == 0) return Results.BadRequest(new { error = "No file in the upload." });
                using var reader = new StreamReader(file.OpenReadStream());
                markdown = await reader.ReadToEndAsync();
                mode = form["mode"].FirstOrDefault() ?? "";
                revertOn = form["revertOn"].FirstOrDefault() ?? "";
            }
            else
            {
                using var reader = new StreamReader(req.Body);
                markdown = await reader.ReadToEndAsync();
                mode = req.Query["mode"].FirstOrDefault() ?? "";
                revertOn = req.Query["revertOn"].FirstOrDefault() ?? "";
            }

            List<ScheduleBlock> blocks;
            try { blocks = ScheduleParser.Parse(markdown); }
            catch (Exception ex) { return Results.BadRequest(new { error = $"Couldn't parse the timetable: {ex.Message}" }); }
            if (blocks.Count == 0)
                return Results.BadRequest(new { error = "No schedule rows found. Expect '## Day' headers with | Time | Duration | Activity | … | tables." });

            var asDefault = string.Equals(mode, "default", StringComparison.OrdinalIgnoreCase);
            if (asDefault)
            {
                await SetSecretAsync(db, "schedule.default", markdown);
                await DeleteSecretAsync(db, "schedule.revertOn");
            }
            else
            {
                if (await GetSecretAsync(db, "schedule.default") is null)
                    return Results.BadRequest(new { error = "Save a default schedule first — then temporary ones can revert to it." });
                if (!DateOnly.TryParse(revertOn, out var rev))
                    return Results.BadRequest(new { error = "Pick a date to return to your default schedule." });
                await SetSecretAsync(db, "schedule.revertOn", rev.ToString("yyyy-MM-dd"));
            }

            await ApplyScheduleBlocksAsync(db, blocks);
            return Results.Ok(new { blocks = blocks.Count, days = blocks.Select(b => b.Day).Distinct().Count(),
                mode = asDefault ? "default" : "temporary", revertOn = asDefault ? null : revertOn });
        }).DisableAntiforgery();

        // Re-apply the saved default schedule now (and clear any pending revert).
        api.MapPost("/schedule/restore-default", async (AppDbContext db) =>
        {
            var def = await GetSecretAsync(db, "schedule.default");
            if (def is null) return Results.BadRequest(new { error = "No default schedule saved yet." });
            var blocks = ScheduleParser.Parse(def);
            if (blocks.Count == 0) return Results.BadRequest(new { error = "The saved default schedule is empty." });
            await ApplyScheduleBlocksAsync(db, blocks);
            await DeleteSecretAsync(db, "schedule.revertOn");
            return Results.Ok(new { blocks = blocks.Count });
        });

        // --- Calendar ---
        api.MapGet("/calendar/upcoming", async (AppDbContext db, int days = 14) =>
        {
            var now = DateTimeOffset.UtcNow;
            var until = now.AddDays(days);
            return await db.CalendarEvents.AsNoTracking()
                .Where(e => e.StartsAt >= now && e.StartsAt <= until)
                .OrderBy(e => e.StartsAt)
                .ToListAsync();
        });
    }
}
