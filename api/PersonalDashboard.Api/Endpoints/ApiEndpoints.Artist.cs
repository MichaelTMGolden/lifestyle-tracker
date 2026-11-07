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

public record ArtistKpiInput(DateOnly? Date, double? MonthlyListeners, double? Followers, double? TotalStreams);

// Artist KPIs entered by hand from Spotify for Artists.
public static partial class ApiEndpoints
{
    // Manual Spotify-for-Artists KPIs — one DataSource, three metric keys (snapshots
    // except total streams, which is cumulative). Targets are optional per key.
    private const string ArtistSourceName = "Spotify for Artists (manual)";
    private static readonly string[] ArtistKpiKeys =
        { "artist_monthly_listeners", "artist_followers", "artist_streams_total" };

    private static void MapArtist(RouteGroupBuilder api)
    {
        // --- Artist KPIs (manual Spotify-for-Artists entry) ---
        // Spotify for Artists has no public API, so these are typed in periodically.
        // They ride MetricSample like every other metric; charts reuse /metrics/{key}.
        api.MapPost("/artist/kpis", async (ArtistKpiInput input, AppDbContext db, HttpRequest req) =>
        {
            var date = input.Date ?? ClientClock.From(req).Today;
            // Pin each date's snapshot to local-midday UTC: a stable RecordedAt so the
            // upsert (keyed on DataSourceId, MetricKey, RecordedAt) corrects re-entries.
            var at = new DateTimeOffset(date.ToDateTime(new TimeOnly(12, 0)), TimeSpan.Zero);
            var source = await GetOrCreateSourceAsync(db, SourceKind.SpotifyArtist, ArtistSourceName);

            var samples = new List<MetricSample>();
            void Add(double? v, string key)
            {
                if (v is double d && d >= 0)
                    samples.Add(new MetricSample { DataSourceId = source.Id, MetricKey = key, RecordedAt = at, Value = d, Unit = "count" });
            }
            Add(input.MonthlyListeners, "artist_monthly_listeners");
            Add(input.Followers, "artist_followers");
            Add(input.TotalStreams, "artist_streams_total");
            if (samples.Count == 0) return Results.BadRequest(new { error = "Provide at least one value." });

            await MetricSampleUpsert.UpsertAsync(db, samples);
            source.LastSyncedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync();
            return Results.Ok(new { written = samples.Count, date });
        });

        // Per-KPI latest value, when it was recorded, change vs the previous entry,
        // and an optional target. Trend charts themselves reuse /metrics/{key}.
        api.MapGet("/artist/summary", async (AppDbContext db) =>
        {
            var settings = await db.DashboardSettings.AsNoTracking().FirstOrDefaultAsync() ?? new DashboardSettings();
            var rows = await db.MetricSamples.AsNoTracking()
                .Where(m => ArtistKpiKeys.Contains(m.MetricKey))
                .OrderBy(m => m.RecordedAt)
                .Select(m => new { m.MetricKey, m.RecordedAt, m.Value })
                .ToListAsync();
            return ArtistKpiKeys.Select(k =>
            {
                var series = rows.Where(r => r.MetricKey == k).ToList();
                var last = series.Count > 0 ? series[^1] : null;
                var prev = series.Count > 1 ? series[^2] : null;
                return new
                {
                    key = k,
                    latest = last?.Value,
                    asOf = last?.RecordedAt,
                    previous = prev?.Value,
                    change = last is not null && prev is not null ? (double?)(last.Value - prev.Value) : null,
                    target = (k switch {
                        "artist_monthly_listeners" => settings.ArtistMonthlyListenersTarget,
                        "artist_followers" => settings.ArtistFollowersTarget,
                        _ => settings.ArtistTotalStreamsTarget,
                    }) is var target && target > 0 ? (double?)target : null,
                };
            }).ToList();
        });
    }
}
