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

public record GarminCredsInput(string Email, string Password);
public record GarminSyncInput(int? Days);
public record GoogleAddInput(string? Label, string IcsUrl);

public record GoogleFeed(string Id, string Label, string Url);

// Connections: the provider list, Garmin and Google Calendar.
public static partial class ApiEndpoints
{
    private static string? MaskEmail(string? email)
    {
        if (string.IsNullOrEmpty(email)) return null;
        var at = email.IndexOf('@');
        if (at <= 1) return email;
        return email[0] + new string('•', Math.Min(6, at - 1)) + email[at..];
    }

    // Fetch an iCal feed (the Google "secret address"). Returns (ok, error, icsText).
    private static async Task<(bool Ok, string? Error, string? Ics)> FetchIcsAsync(IHttpClientFactory httpFactory, string url)
    {
        try
        {
            var http = httpFactory.CreateClient();
            http.Timeout = TimeSpan.FromSeconds(30);
            using var resp = await http.GetAsync(url);
            if (!resp.IsSuccessStatusCode)
                return (false, $"calendar feed returned {(int)resp.StatusCode}", null);
            var text = await resp.Content.ReadAsStringAsync();
            if (!text.Contains("BEGIN:VCALENDAR", StringComparison.OrdinalIgnoreCase))
                return (false, "that URL isn't an iCal feed", null);
            return (true, null, text);
        }
        catch (Exception ex)
        {
            return (false, $"couldn't fetch the feed: {ex.Message}", null);
        }
    }

    // --- Google Calendar feed list (stored encrypted as JSON in AppSecret) ---
    private static async Task<List<GoogleFeed>> LoadGoogleFeedsAsync(AppDbContext db)
    {
        var raw = await GetSecretAsync(db, "google.calendars");
        if (raw is not null)
        {
            var json = SecretCrypto.Decrypt(raw);
            if (json is not null)
                try { return System.Text.Json.JsonSerializer.Deserialize<List<GoogleFeed>>(json) ?? new(); }
                catch { return new(); }
            return new();
        }
        // Migrate the old single-URL secret into the list form.
        var legacy = await GetSecretAsync(db, "google.ics");
        if (legacy is not null && SecretCrypto.Decrypt(legacy) is string url)
        {
            var feeds = new List<GoogleFeed> { new(Guid.NewGuid().ToString("n")[..8], "Calendar", url) };
            await SaveGoogleFeedsAsync(db, feeds);
            await DeleteSecretAsync(db, "google.ics");
            return feeds;
        }
        return new();
    }

    private static Task SaveGoogleFeedsAsync(AppDbContext db, List<GoogleFeed> feeds) =>
        SetSecretAsync(db, "google.calendars", SecretCrypto.Encrypt(System.Text.Json.JsonSerializer.Serialize(feeds)));

    // Fetch every feed, parse into one "Google Calendar" source, replace the window.
    // A feed that fails is reported and skipped; if every feed fails we leave the
    // existing events alone (don't wipe on a transient network blip).
    private static async Task<(int Events, List<string> Failures)> SyncGoogleAsync(AppDbContext db, IHttpClientFactory http, List<GoogleFeed> feeds)
    {
        var src = await GetOrCreateSourceAsync(db, SourceKind.GoogleCalendar, "Google Calendar");
        var now = DateTime.UtcNow;
        var all = new List<CalendarEvent>();
        var failures = new List<string>();
        foreach (var f in feeds)
        {
            var (ok, err, ics) = await FetchIcsAsync(http, f.Url);
            if (!ok) { failures.Add($"{f.Label}: {err}"); continue; }
            try { all.AddRange(GoogleCalendarSync.Parse(ics!, src.Id, now.AddDays(-14), now.AddDays(120), $"{f.Id}:")); }
            catch { failures.Add($"{f.Label}: not a valid iCal feed"); }
        }

        // Don't blow away events if everything failed (e.g. offline).
        if (feeds.Count > 0 && failures.Count == feeds.Count)
            return (0, failures);

        await db.CalendarEvents.Where(e => e.DataSourceId == src.Id).ExecuteDeleteAsync();
        // Drop the placeholder "Google Calendar (sample)" seed so real events stand alone.
        var sample = await db.DataSources.FirstOrDefaultAsync(s => s.Kind == SourceKind.GoogleCalendar && s.Name == "Google Calendar (sample)");
        if (sample is not null)
        {
            await db.CalendarEvents.Where(e => e.DataSourceId == sample.Id).ExecuteDeleteAsync();
            db.DataSources.Remove(sample);
        }
        db.CalendarEvents.AddRange(all);
        src.LastSyncedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync();
        return (all.Count, failures);
    }

    /// <summary>Sync all stored Google calendars (used by the background auto-sync job).
    /// Returns (events, failures, configured); configured=false means no calendars set.</summary>
    internal static async Task<(int Events, List<string> Failures, bool Configured)> SyncGoogleStoredAsync(AppDbContext db, IHttpClientFactory http)
    {
        var feeds = await LoadGoogleFeedsAsync(db);
        if (feeds.Count == 0) return (0, new(), false);
        var (events, failures) = await SyncGoogleAsync(db, http, feeds);
        return (events, failures, true);
    }

    private static void MapConnections(RouteGroupBuilder api)
    {
        // --- Connections (integration framework) ---
        api.MapGet("/connections", async (AppDbContext db, IEnumerable<IDataProvider> providers) =>
        {
            var list = new List<object>();
            foreach (var p in providers)
            {
                var kind = p.Kind;
                var ds = await db.DataSources.Where(s => s.Kind == kind)
                    .OrderByDescending(s => s.LastSyncedAt).FirstOrDefaultAsync();
                int records = kind switch
                {
                    SourceKind.GoogleCalendar => await db.CalendarEvents.CountAsync(),
                    SourceKind.Spotify => await db.MusicPlays.CountAsync(),
                    _ => await db.MetricSamples.CountAsync(m =>
                        db.DataSources.Where(s => s.Kind == kind).Select(s => s.Id).Contains(m.DataSourceId)),
                };
                list.Add(new
                {
                    kind = kind.ToString(), name = p.Name, mode = p.Mode.ToString(),
                    configured = p.Configured, status = p.Status,
                    lastSyncedAt = ds?.LastSyncedAt, records,
                });
            }
            return list;
        });

        api.MapPost("/connections/{kind}/sync", async (string kind, AppDbContext db, HttpRequest req, IEnumerable<IDataProvider> providers) =>
        {
            if (!Enum.TryParse<SourceKind>(kind, true, out var k)) return Results.NotFound();
            var p = providers.FirstOrDefault(x => x.Kind == k);
            if (p is null) return Results.NotFound();
            var result = await p.SyncAsync(db, ClientClock.From(req).OffsetMinutes);
            if (result.Ok)
            {
                var ds = await db.DataSources.FirstOrDefaultAsync(s => s.Kind == k);
                if (ds is not null) { ds.LastSyncedAt = DateTimeOffset.UtcNow; await db.SaveChangesAsync(); }
            }
            return Results.Ok(result);
        });

        // Productionised import: upload Garmin Connect export files, then ingest.
        api.MapPost("/connections/garmin/import", async (HttpRequest req, AppDbContext db, IEnumerable<IDataProvider> providers) =>
        {
            if (!req.HasFormContentType) return Results.BadRequest(new { error = "Expected a multipart file upload." });
            var garmin = providers.OfType<GarminImportProvider>().FirstOrDefault();
            if (garmin is null) return Results.Problem("Garmin provider not registered.");
            var dir = garmin.ImportDir;
            Directory.CreateDirectory(dir);

            var form = await req.ReadFormAsync();
            var saved = 0;
            foreach (var f in form.Files)
            {
                var name = Path.GetFileName(f.FileName);
                if (string.IsNullOrWhiteSpace(name) || !name.EndsWith(".csv", StringComparison.OrdinalIgnoreCase)) continue;
                await using var fs = File.Create(Path.Combine(dir, name));
                await f.CopyToAsync(fs);
                saved++;
            }
            if (saved == 0) return Results.BadRequest(new { error = "No .csv files in the upload." });

            var r = await new GarminCsvImporter(db).ImportAsync(dir);
            var ds = await db.DataSources.FirstOrDefaultAsync(s => s.Kind == SourceKind.Garmin);
            if (ds is not null) { ds.LastSyncedAt = DateTimeOffset.UtcNow; await db.SaveChangesAsync(); }
            return Results.Ok(new { ok = true, filesSaved = saved, records = r.SamplesWritten,
                message = $"{r.HealthDays} health days · {r.SleepDays} sleep days · {r.SamplesWritten} samples written." });
        }).DisableAntiforgery();

        // --- Garmin live connection (credentials stored server-side; sync runs via the Python sidecar) ---
        api.MapGet("/connections/garmin", async (AppDbContext db) =>
        {
            var email = await GetSecretAsync(db, "garmin.email");
            var configured = email is not null && await GetSecretAsync(db, "garmin.pw") is not null;
            var src = await db.DataSources.FirstOrDefaultAsync(s => s.Kind == SourceKind.Garmin && s.Name == "Garmin (live)");
            var count = src is null ? 0 : await db.MetricSamples.CountAsync(m => m.DataSourceId == src.Id);
            return Results.Ok(new { configured, email = MaskEmail(email), lastSyncedAt = src?.LastSyncedAt, sampleCount = count });
        });

        // Store credentials (password encrypted). Verifies them with a 1-day sidecar pull first.
        api.MapPost("/connections/garmin/credentials", async (GarminCredsInput body, AppDbContext db, IHttpClientFactory http, IConfiguration cfg) =>
        {
            if (string.IsNullOrWhiteSpace(body?.Email) || string.IsNullOrWhiteSpace(body?.Password))
                return Results.BadRequest(new { error = "email and password required" });
            var (ok, err, _) = await GarminSyncService.PullAsync(http, cfg, body.Email.Trim(), body.Password, 1, null);
            if (!ok) return Results.Json(new { error = $"Garmin sign-in failed: {err}" }, statusCode: StatusCodes.Status502BadGateway);
            await SetSecretAsync(db, "garmin.email", body.Email.Trim());
            await SetSecretAsync(db, "garmin.pw", SecretCrypto.Encrypt(body.Password));
            return Results.Ok(new { configured = true });
        });

        // Pull recent days from Garmin (via the sidecar) and upsert under "Garmin (live)".
        api.MapPost("/connections/garmin/sync", async (GarminSyncInput? body, AppDbContext db, IHttpClientFactory http, IConfiguration cfg) =>
        {
            var email = await GetSecretAsync(db, "garmin.email");
            var pwEnc = await GetSecretAsync(db, "garmin.pw");
            if (email is null || pwEnc is null) return Results.Json(new { error = "Garmin not connected" }, statusCode: StatusCodes.Status400BadRequest);
            var pw = SecretCrypto.Decrypt(pwEnc);
            if (pw is null) return Results.Json(new { error = "stored credentials can't be read — reconnect Garmin" }, statusCode: StatusCodes.Status400BadRequest);

            var days = Math.Clamp(body?.Days ?? 14, 1, 365);
            var (ok, err, samples) = await GarminSyncService.PullAsync(http, cfg, email, pw, days, null);
            if (!ok) return Results.Json(new { error = err }, statusCode: StatusCodes.Status502BadGateway);

            var written = await GarminSyncService.UpsertAsync(db, samples!);
            return Results.Ok(new { written, days });
        });

        api.MapDelete("/connections/garmin/credentials", async (AppDbContext db) =>
        {
            await DeleteSecretAsync(db, "garmin.email");
            await DeleteSecretAsync(db, "garmin.pw");
            return Results.Ok(new { configured = false });
        });

        // Drop the placeholder seed sources so real data doesn't double-count.
        api.MapPost("/connections/garmin/clear-samples", async (AppDbContext db) =>
        {
            var targets = new (SourceKind Kind, string Name)[]
            {
                (SourceKind.Garmin, "Garmin (sample)"),
                (SourceKind.Garmin, "Garmin (imported)"),
                (SourceKind.MyFitnessPal, "MyFitnessPal (sample)"),
            };
            var deleted = 0;
            foreach (var (kind, name) in targets)
            {
                var s = await db.DataSources.FirstOrDefaultAsync(x => x.Kind == kind && x.Name == name);
                if (s is null) continue;
                deleted += await db.MetricSamples.Where(m => m.DataSourceId == s.Id).ExecuteDeleteAsync();
                db.DataSources.Remove(s);
            }
            await db.SaveChangesAsync();
            return Results.Ok(new { deleted });
        });

        // --- Google Calendar (read-only; one or more calendars via their secret iCal URLs) ---
        api.MapGet("/connections/google", async (AppDbContext db) =>
        {
            var feeds = await LoadGoogleFeedsAsync(db);
            var src = await db.DataSources.FirstOrDefaultAsync(s => s.Kind == SourceKind.GoogleCalendar && s.Name == "Google Calendar");
            var count = src is null ? 0 : await db.CalendarEvents.CountAsync(e => e.DataSourceId == src.Id);
            return Results.Ok(new
            {
                configured = feeds.Count > 0,
                calendars = feeds.Select(f => new { f.Id, f.Label }),
                lastSyncedAt = src?.LastSyncedAt,
                eventCount = count,
            });
        });

        // Add a calendar: validate the feed, store it, then sync everything.
        api.MapPost("/connections/google/calendars", async (GoogleAddInput body, AppDbContext db, IHttpClientFactory http) =>
        {
            var url = body?.IcsUrl?.Trim();
            if (string.IsNullOrWhiteSpace(url) || !url.StartsWith("http", StringComparison.OrdinalIgnoreCase))
                return Results.BadRequest(new { error = "Paste a calendar's secret iCal URL (https://…/basic.ics)." });
            var (ok, err, ics) = await FetchIcsAsync(http, url);
            if (!ok) return Results.Json(new { error = err }, statusCode: StatusCodes.Status502BadGateway);
            try { GoogleCalendarSync.Parse(ics!, 0, DateTime.UtcNow, DateTime.UtcNow.AddDays(1)); }
            catch { return Results.Json(new { error = "That URL didn't look like a valid iCal feed." }, statusCode: StatusCodes.Status400BadRequest); }

            var feeds = await LoadGoogleFeedsAsync(db);
            if (feeds.Any(f => string.Equals(f.Url, url, StringComparison.OrdinalIgnoreCase)))
                return Results.Json(new { error = "That calendar is already connected." }, statusCode: StatusCodes.Status409Conflict);
            var label = string.IsNullOrWhiteSpace(body!.Label) ? $"Calendar {feeds.Count + 1}" : body.Label!.Trim();
            var feed = new GoogleFeed(Guid.NewGuid().ToString("n")[..8], label, url);
            feeds.Add(feed);
            await SaveGoogleFeedsAsync(db, feeds);
            await SyncGoogleAsync(db, http, feeds);
            return Results.Ok(new { feed.Id, feed.Label });
        });

        // Remove a calendar and re-sync the rest.
        api.MapDelete("/connections/google/calendars/{id}", async (string id, AppDbContext db, IHttpClientFactory http) =>
        {
            var feeds = await LoadGoogleFeedsAsync(db);
            feeds.RemoveAll(f => f.Id == id);
            await SaveGoogleFeedsAsync(db, feeds);
            await SyncGoogleAsync(db, http, feeds);
            return Results.Ok(new { calendars = feeds.Count });
        });

        // Re-fetch every connected calendar and rebuild the event window.
        api.MapPost("/connections/google/sync", async (AppDbContext db, IHttpClientFactory http) =>
        {
            var feeds = await LoadGoogleFeedsAsync(db);
            if (feeds.Count == 0) return Results.Json(new { error = "No calendars connected" }, statusCode: StatusCodes.Status400BadRequest);
            var (events, failures) = await SyncGoogleAsync(db, http, feeds);
            return Results.Ok(new { events, calendars = feeds.Count, failures });
        });

        // Disconnect all calendars.
        api.MapDelete("/connections/google/credentials", async (AppDbContext db) =>
        {
            await DeleteSecretAsync(db, "google.calendars");
            await DeleteSecretAsync(db, "google.ics");
            var src = await db.DataSources.FirstOrDefaultAsync(s => s.Kind == SourceKind.GoogleCalendar && s.Name == "Google Calendar");
            if (src is not null) await db.CalendarEvents.Where(e => e.DataSourceId == src.Id).ExecuteDeleteAsync();
            return Results.Ok(new { configured = false });
        });
    }
}
