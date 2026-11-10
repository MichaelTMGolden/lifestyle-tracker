using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using PersonalDashboard.Api.Data;
using PersonalDashboard.Api.Domain;
using PersonalDashboard.Api.Integrations;

namespace PersonalDashboard.Api.Endpoints;

public record HevyKeyInput(string Key);
public record WorkoutHabitsInput(int? Strength, int? Run, int? Other);

/// <summary>Workouts from Hevy (pulled) and Apple Health (pushed from the phone), and their settings.</summary>
public static class WorkoutEndpoints
{
    /// <summary>The phone's upload address. The only /api route outside the app password: it checks its own key.</summary>
    public const string IngestPath = "/api/ingest/workouts";
    const string IngestKeySecret = "health.ingest";
    const string HealthSourceName = "Apple Health";
    const long MaxIngestBytes = 8 * 1024 * 1024;

    internal static void Map(RouteGroupBuilder api)
    {
        // --- Hevy ---
        api.MapGet("/connections/hevy", async (AppDbContext db) =>
        {
            var src = await db.DataSources.AsNoTracking().FirstOrDefaultAsync(s => s.Kind == SourceKind.Hevy);
            return new
            {
                connected = await db.AppSecrets.AnyAsync(s => s.Key == HevySync.KeySecret),
                lastSyncedAt = src?.LastSyncedAt,
                workouts = src is null ? 0 : await db.Workouts.CountAsync(w => w.DataSourceId == src.Id),
            };
        });

        api.MapPut("/connections/hevy/key", async (HevyKeyInput body, AppDbContext db, IHttpClientFactory http, HttpRequest req) =>
        {
            var key = body.Key?.Trim() ?? "";
            if (key.Length is < 8 or > 200) return Results.BadRequest(new { message = "Paste the API key from hevy.com/settings?developer." });
            var client = http.CreateClient("hevy");
            if (await HevySync.CheckKeyAsync(client, key) is string problem) return Results.BadRequest(new { message = problem });
            await SetSecretAsync(db, HevySync.KeySecret, SecretCrypto.Encrypt(key));
            await DeleteSecretAsync(db, HevySync.CursorSecret); // a (possibly different) account: read everything once
            var result = await HevySync.SyncAsync(db, client, key, ClientClock.From(req).Today, await WorkoutStore.UserDayAsync(db, ClientClock.From(req).OffsetMinutes));
            return Results.Ok(result);
        });

        api.MapPost("/connections/hevy/sync", async (AppDbContext db, IHttpClientFactory http, HttpRequest req) =>
        {
            if (!await db.AppSecrets.AnyAsync(s => s.Key == HevySync.KeySecret)) return Results.BadRequest(new { message = "Connect Hevy first." });
            var result = await HevySync.SyncStoredAsync(db, http.CreateClient("hevy"), ClientClock.From(req).Today, await WorkoutStore.UserDayAsync(db, ClientClock.From(req).OffsetMinutes));
            return result.Ok ? Results.Ok(result) : Results.BadRequest(new { message = result.Error });
        });

        // Forgets the key; workouts already imported stay.
        api.MapDelete("/connections/hevy/key", async (AppDbContext db) =>
        {
            await DeleteSecretAsync(db, HevySync.KeySecret);
            await DeleteSecretAsync(db, HevySync.CursorSecret);
            return Results.NoContent();
        });

        // --- Apple Health (pushed from the phone) ---
        api.MapGet("/connections/health", async (AppDbContext db) =>
        {
            var src = await db.DataSources.AsNoTracking().FirstOrDefaultAsync(s => s.Kind == SourceKind.AppleHealth);
            return new
            {
                hasKey = await db.AppSecrets.AnyAsync(s => s.Key == IngestKeySecret),
                lastReceivedAt = src?.LastSyncedAt,
                workouts = src is null ? 0 : await db.Workouts.CountAsync(w => w.DataSourceId == src.Id),
                path = IngestPath,
            };
        });

        // A new upload key, shown this once; only its hash is kept. Replaces any old key.
        api.MapPost("/connections/health/key", async (AppDbContext db) =>
        {
            var key = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
            await SetSecretAsync(db, IngestKeySecret, Hash(key));
            return Results.Ok(new { key, path = IngestPath });
        });

        api.MapDelete("/connections/health/key", async (AppDbContext db) =>
        {
            await DeleteSecretAsync(db, IngestKeySecret);
            return Results.NoContent();
        });

        // --- Which habit each kind of workout ticks ---
        api.MapGet("/connections/workouts/habits", async (AppDbContext db) => await WorkoutStore.HabitsAsync(db));
        api.MapPut("/connections/workouts/habits", async (WorkoutHabitsInput body, AppDbContext db) =>
        {
            var ids = new[] { body.Strength, body.Run, body.Other }.OfType<int>().Distinct().ToList();
            var known = await db.Habits.Where(h => ids.Contains(h.Id) && !h.Archived).Select(h => h.Id).ToListAsync();
            if (known.Count != ids.Count) return Results.BadRequest(new { message = "unknown habit" });
            await WorkoutStore.SaveHabitsAsync(db, new WorkoutHabits(body.Strength, body.Run, body.Other));
            return Results.NoContent();
        });

        // --- Workouts for the screens: the last N days, newest first, with set totals ---
        api.MapGet("/workouts/recent", async (AppDbContext db, HttpRequest req, int days = 90) =>
        {
            var since = ClientClock.From(req).TodayStartUtc.AddDays(-Math.Clamp(days, 1, 400));
            var rows = await db.Workouts.AsNoTracking().Where(w => w.StartedAt >= since)
                .OrderByDescending(w => w.StartedAt)
                .Select(w => new
                {
                    w.Id, w.Type, w.Title, w.StartedAt, w.EndedAt, w.DurationMinutes, w.DistanceMeters, w.Calories, w.AverageHeartRate,
                    source = w.DataSource!.Name,
                    sets = w.Sets.Where(s => s.Kind != "warmup").Count(),
                    volumeKg = w.Sets.Where(s => s.Kind != "warmup").Sum(s => (s.WeightKg ?? 0) * (s.Reps ?? 0)),
                    exercises = w.Sets.Select(s => s.Exercise).Distinct().Take(6).ToList(),
                })
                .ToListAsync();
            return rows;
        });
    }

    /// <summary>Uploads from the phone. Mapped on the app (not the /api group's auth) and checks its own key.</summary>
    internal static void MapIngest(WebApplication app)
    {
        app.MapPost(IngestPath, async (HttpRequest req, AppDbContext db) =>
        {
            var stored = await db.AppSecrets.AsNoTracking().Where(s => s.Key == IngestKeySecret).Select(s => s.Value).FirstOrDefaultAsync();
            var auth = req.Headers.Authorization.ToString();
            var given = auth.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) ? auth[7..].Trim() : req.Headers["X-Ingest-Key"].ToString();
            if (stored is null || given.Length == 0
                || !CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(Hash(given)), Encoding.ASCII.GetBytes(stored)))
                return Results.Json(new { error = "unauthorized" }, statusCode: StatusCodes.Status401Unauthorized);
            if (req.ContentLength is > MaxIngestBytes) return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);

            JsonDocument doc;
            try { doc = await JsonDocument.ParseAsync(req.Body); }
            catch (JsonException) { return Results.BadRequest(new { message = "Send JSON: Health Auto Export's format, or {\"workouts\": [...]}." }); }
            using (doc)
            {
                var (workouts, skipped, tooMany) = HealthIngest.Parse(doc.RootElement);
                if (tooMany) return Results.Json(new { message = $"Too many workouts in one upload (over {HealthIngest.MaxWorkouts}). Send a shorter period." }, statusCode: StatusCodes.Status413PayloadTooLarge);
                var source = await WorkoutStore.SourceAsync(db, SourceKind.AppleHealth, HealthSourceName);
                var habits = await WorkoutStore.HabitsAsync(db);
                // Hevy also writes its workouts to Apple Health; with Hevy connected directly
                // (sets and all), those copies would count every session twice.
                var hevyDirect = await db.AppSecrets.AnyAsync(s => s.Key == HevySync.KeySecret);
                int created = 0, updated = 0, fromHevy = 0;
                foreach (var w in workouts)
                {
                    if (hevyDirect && w.RecordedBy?.Contains("hevy", StringComparison.OrdinalIgnoreCase) == true) { fromHevy++; continue; }
                    // Health sends local times: "today" by the same clock as the workout's day.
                    var today = WorkoutStore.OwnDay(DateTimeOffset.UtcNow.ToOffset(w.StartedAt.Offset));
                    if (await WorkoutStore.UpsertAsync(db, source, w, today, habits, WorkoutStore.OwnDay)) created++; else updated++;
                }
                source.LastSyncedAt = DateTimeOffset.UtcNow;
                await db.SaveChangesAsync();
                return Results.Ok(new { created, updated, skipped, fromHevy });
            }
        });
    }

    static string Hash(string key) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes("pd-ingest::" + key)));

    static async Task SetSecretAsync(AppDbContext db, string key, string value)
    {
        var row = await db.AppSecrets.FirstOrDefaultAsync(s => s.Key == key);
        if (row is null) db.AppSecrets.Add(new AppSecret { Key = key, Value = value }); else row.Value = value;
        await db.SaveChangesAsync();
    }
    static async Task DeleteSecretAsync(AppDbContext db, string key)
    {
        var row = await db.AppSecrets.FirstOrDefaultAsync(s => s.Key == key);
        if (row is null) return;
        db.AppSecrets.Remove(row);
        await db.SaveChangesAsync();
    }
}
