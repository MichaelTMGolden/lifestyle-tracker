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

public record WeightInput(double Value);

public record IngestSample(string Key, DateTimeOffset At, double Value, string? Unit);
public record IngestInput(string? Source, string? Kind, List<IngestSample>? Samples);

// Health metrics: the summary, metric series, sleep, weight, workouts, music and ingest.
public static partial class ApiEndpoints
{
    // Upsert pre-mapped samples under a named source (shared by /ingest and Garmin sync).
    private static async Task<int> UpsertSamplesAsync(AppDbContext db, string name, SourceKind kind, List<IngestSample> input)
    {
        var source = await GetOrCreateSourceAsync(db, kind, name);
        var samples = input
            .Where(s => !string.IsNullOrWhiteSpace(s.Key))
            .Select(s => new MetricSample
            {
                DataSourceId = source.Id,
                MetricKey = s.Key.Trim(),
                RecordedAt = s.At.ToUniversalTime(),
                Value = Math.Round(s.Value, 2),
                Unit = s.Unit ?? "",
            })
            .ToList();
        await MetricSampleUpsert.UpsertAsync(db, samples);
        source.LastSyncedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync();
        return samples.Count;
    }

    private static void MapMetrics(RouteGroupBuilder api)
    {
        // --- Dashboard summary: one call the frontend can render a homepage from ---
        api.MapGet("/summary", async (AppDbContext db) =>
        {
            var today = DateOnly.FromDateTime(DateTime.UtcNow.Date);
            var weekAgo = DateTimeOffset.UtcNow.AddDays(-7);
            var now = DateTimeOffset.UtcNow;

            var latestWeight = await db.MetricSamples
                .Where(m => m.MetricKey == "weight_kg")
                .OrderByDescending(m => m.RecordedAt)
                .Select(m => (double?)m.Value)
                .FirstOrDefaultAsync();

            var latestRestingHr = await db.MetricSamples
                .Where(m => m.MetricKey == "resting_hr")
                .OrderByDescending(m => m.RecordedAt)
                .Select(m => (double?)m.Value)
                .FirstOrDefaultAsync();

            var avgSleepHoursThisWeek = await db.MetricSamples
                .Where(m => m.MetricKey == "sleep_total_min" && m.RecordedAt >= weekAgo)
                .AverageAsync(m => (double?)m.Value);

            var stepsThisWeek = await db.MetricSamples
                .Where(m => m.MetricKey == "steps" && m.RecordedAt >= weekAgo)
                .SumAsync(m => (double?)m.Value) ?? 0;

            var workoutsThisWeek = await db.Workouts.CountAsync(w => w.StartedAt >= weekAgo);

            var habitsToday = await db.HabitLogs.CountAsync(l => l.Date == today && l.Completed);
            var habitsTotal = await db.Habits.CountAsync(h => !h.Archived);

            var openTodos = await db.TodoItems.CountAsync(t => t.CompletedAt == null);

            var upcomingEvents = await db.CalendarEvents
                .Where(e => e.StartsAt >= now)
                .OrderBy(e => e.StartsAt)
                .Take(5)
                .ToListAsync();

            return Results.Ok(new
            {
                latestWeightKg = latestWeight,
                latestRestingHr,
                avgSleepHoursThisWeek = avgSleepHoursThisWeek.HasValue
                    ? Math.Round(avgSleepHoursThisWeek.Value / 60.0, 1)
                    : (double?)null,
                stepsThisWeek = (long)stepsThisWeek,
                workoutsThisWeek,
                habitsCompletedToday = habitsToday,
                habitsTotal,
                openTodos,
                upcomingEvents,
            });
        });

        // --- List available metric keys (handy for building charts dynamically) ---
        api.MapGet("/metrics", async (AppDbContext db) =>
            await db.MetricSamples
                .GroupBy(m => new { m.MetricKey, m.Unit })
                .Select(g => new { key = g.Key.MetricKey, unit = g.Key.Unit, count = g.Count() })
                .OrderBy(x => x.key)
                .ToListAsync());

        // --- Per-night sleep breakdown for a stacked-bar chart ---
        api.MapGet("/sleep", async (AppDbContext db, HttpRequest req, int days = 30) =>
        {
            // Sleep summaries are stored under their source calendar date in UTC.
            var today = ClientClock.From(req).Today;
            var end = new DateTimeOffset(today.AddDays(1).ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);
            var since = end.AddDays(-Math.Clamp(days, 1, 3650));
            var rows = await db.MetricSamples.AsNoTracking().Include(m => m.DataSource)
                .Where(m => m.RecordedAt >= since && m.RecordedAt < end && SleepAggregation.Keys.Contains(m.MetricKey))
                .ToListAsync();
            return Results.Ok(SleepAggregation.Build(rows));
        });

        // --- Metrics: time series for charting ---
        api.MapGet("/metrics/{key}", async (string key, AppDbContext db, int days = 90) =>
        {
            var since = DateTimeOffset.UtcNow.AddDays(-days);
            var data = await db.MetricSamples
                .Where(m => m.MetricKey == key && m.RecordedAt >= since)
                .OrderBy(m => m.RecordedAt)
                .Select(m => new { m.RecordedAt, m.Value, m.Unit,
                    sourceName = m.DataSource!.Name, sourceKind = m.DataSource.Kind,
                    isDerived = m.DataSource.Name.Contains("(sample)") ||
                        (m.DataSource.Name.Contains("(imported)") &&
                         (m.MetricKey == "sleep_score" || m.MetricKey == "stress_avg" || m.MetricKey == "resting_hr")) })
                .ToListAsync();
            return Results.Ok(data);
        });

        // --- Manual weight entry ---
        api.MapPost("/weight", async (WeightInput input, AppDbContext db, HttpRequest req) =>
        {
            if (input.Value < 30 || input.Value > 300) return Results.BadRequest(new { error = "Out of range" });
            var source = await db.DataSources.FirstOrDefaultAsync(s => s.Kind == SourceKind.Manual)
                ?? new DataSource { Name = "Manual entry", Kind = SourceKind.Manual };
            if (source.Id == 0) { db.DataSources.Add(source); await db.SaveChangesAsync(); }

            var clock = ClientClock.From(req);
            var dayStart = clock.TodayStartUtc;
            var when = dayStart.AddHours(7);
            // Replace any existing manual weight for today so re-entry overwrites.
            await db.MetricSamples
                .Where(m => m.MetricKey == "weight_kg" && m.DataSourceId == source.Id
                    && m.RecordedAt >= dayStart && m.RecordedAt < clock.TodayEndUtc)
                .ExecuteDeleteAsync();
            db.MetricSamples.Add(new MetricSample
            {
                DataSourceId = source.Id, MetricKey = "weight_kg",
                RecordedAt = when, Value = Math.Round(input.Value, 1), Unit = "kg",
            });
            await db.SaveChangesAsync();
            return Results.Ok(new { ok = true, value = Math.Round(input.Value, 1) });
        });

        // --- Workouts ---
        api.MapGet("/workouts", async (AppDbContext db, int take = 50) =>
            await db.Workouts.AsNoTracking().OrderByDescending(w => w.StartedAt).Take(take).ToListAsync());

        // --- Recently played music ---
        api.MapGet("/music/recent", async (AppDbContext db, int take = 50) =>
            await db.MusicPlays.AsNoTracking().OrderByDescending(p => p.PlayedAt).Take(take).ToListAsync());

        // --- Metric ingest (live Garmin sync via the Python tool, or any external feed) ---
        // Upserts pre-mapped samples under a named DataSource, keyed on
        // (DataSourceId, MetricKey, RecordedAt) so re-pulling overlapping days is idempotent.
        api.MapPost("/ingest/metrics", async (IngestInput input, AppDbContext db) =>
        {
            if (input?.Samples is null || input.Samples.Count == 0)
                return Results.BadRequest(new { message = "no samples" });

            var name = string.IsNullOrWhiteSpace(input.Source) ? "Garmin (live)" : input.Source!.Trim();
            var kind = Enum.TryParse<SourceKind>(input.Kind, ignoreCase: true, out var k) ? k : SourceKind.Garmin;
            var written = await UpsertSamplesAsync(db, name, kind, input.Samples);
            return Results.Ok(new { source = name, written });
        });

        // Retire a data source and its samples — used to drop the placeholder
        // "Garmin (imported)" seed once real "Garmin (live)" data is flowing, so
        // the two don't double-count (metric reads aggregate across all sources).
        api.MapDelete("/ingest/source/{name}", async (string name, string? kind, AppDbContext db) =>
        {
            var k = Enum.TryParse<SourceKind>(kind, ignoreCase: true, out var kk) ? kk : SourceKind.Garmin;
            var source = await db.DataSources.FirstOrDefaultAsync(s => s.Kind == k && s.Name == name);
            if (source is null) return Results.Ok(new { source = name, deleted = 0 });
            var deleted = await db.MetricSamples.Where(m => m.DataSourceId == source.Id).ExecuteDeleteAsync();
            db.DataSources.Remove(source);
            await db.SaveChangesAsync();
            return Results.Ok(new { source = name, deleted });
        });
    }
}
