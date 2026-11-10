using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using PersonalDashboard.Api.Data;
using PersonalDashboard.Api.Domain;

namespace PersonalDashboard.Api.Integrations;

/// <summary>
/// Lifting workouts from Hevy's public API (Hevy Pro; key from
/// hevy.com/settings?developer, sent as the api-key header). The first sync
/// reads every workout; later ones read only changes since the last good sync
/// (workout events: updated or deleted). The key is stored encrypted.
/// </summary>
public static class HevySync
{
    public const string KeySecret = "hevy.key";
    public const string CursorSecret = "hevy.since";
    public const string SourceName = "Hevy";
    const string Base = "https://api.hevyapp.com/v1/";
    const int PageSize = 10; // the API's maximum
    const int MaxPages = 2000; // 20,000 workouts: far beyond any real history, a backstop only

    public record Result(bool Ok, string? Error, int Created, int Updated, int Deleted);

    /// <summary>Checks a key against Hevy (user info). Null when it works, else why not.</summary>
    public static async Task<string?> CheckKeyAsync(HttpClient http, string key)
    {
        using var res = await Send(http, key, "user/info");
        return res.StatusCode switch
        {
            HttpStatusCode.OK => null,
            HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden => "Hevy didn't accept that key. It needs Hevy Pro; copy it from hevy.com/settings?developer.",
            _ => $"Hevy didn't answer as expected ({(int)res.StatusCode}). Try again shortly.",
        };
    }

    /// <summary>Syncs with the stored key; does nothing (Ok, no error) when none is stored.</summary>
    public static async Task<Result> SyncStoredAsync(AppDbContext db, HttpClient http, DateOnly today, Func<DateTimeOffset, DateOnly> dayOf)
    {
        var enc = await db.AppSecrets.AsNoTracking().Where(s => s.Key == KeySecret).Select(s => s.Value).FirstOrDefaultAsync();
        if (enc is null) return new(true, null, 0, 0, 0);
        var key = SecretCrypto.Decrypt(enc);
        if (key is null) return new(false, "The stored Hevy key couldn't be read; paste it again.", 0, 0, 0);
        return await SyncAsync(db, http, key, today, dayOf);
    }

    public static async Task<Result> SyncAsync(AppDbContext db, HttpClient http, string key, DateOnly today, Func<DateTimeOffset, DateOnly> dayOf)
    {
        var source = await WorkoutStore.SourceAsync(db, SourceKind.Hevy, SourceName);
        var habits = await WorkoutStore.HabitsAsync(db);
        var since = await db.AppSecrets.AsNoTracking().Where(s => s.Key == CursorSecret).Select(s => s.Value).FirstOrDefaultAsync();
        var started = DateTimeOffset.UtcNow;
        int created = 0, updated = 0, deleted = 0;
        var complete = false; // reached the last page, so the cursor may move on

        for (var page = 1; page <= MaxPages; page++)
        {
            var path = since is null ? $"workouts?page={page}&pageSize={PageSize}"
                : $"workouts/events?page={page}&pageSize={PageSize}&since={Uri.EscapeDataString(since)}";
            using var res = await Send(http, key, path);
            if (res.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
                return new(false, "Hevy no longer accepts the stored key (is Hevy Pro still active?).", created, updated, deleted);
            // Past the last page Hevy can answer 404: that's the end, not an error.
            if (res.StatusCode == HttpStatusCode.NotFound && page > 1) { complete = true; break; }
            if (!res.IsSuccessStatusCode) return new(false, $"Hevy sync stopped ({(int)res.StatusCode}).", created, updated, deleted);

            using var doc = JsonDocument.Parse(await res.Content.ReadAsStreamAsync());
            var root = doc.RootElement;
            var items = since is null ? Array(root, "workouts") : Array(root, "events");
            foreach (var item in items)
            {
                if (since is not null && Str(item, "type") == "deleted")
                {
                    if (Str(item, "id") is string gone)
                    {
                        var rows = await db.Workouts.Include(w => w.Sets).Where(w => w.DataSourceId == source.Id && w.ExternalId == gone).ToListAsync();
                        db.Workouts.RemoveRange(rows);
                        await db.SaveChangesAsync();
                        deleted += rows.Count;
                    }
                    continue;
                }
                var workout = since is null ? item : item.TryGetProperty("workout", out var inner) ? inner : default;
                if (ToIncoming(workout) is not { } w) continue;
                if (await WorkoutStore.UpsertAsync(db, source, w, today, habits, dayOf)) created++; else updated++;
            }
            var pageCount = root.TryGetProperty("page_count", out var pc) && pc.TryGetInt32(out var n) ? n : page;
            if (page >= pageCount || items.Count == 0) { complete = true; break; }
        }

        // Stopped at the page limit with more to read: keep the old cursor (or none,
        // for a first import), so the next sync carries on rather than skipping the rest.
        if (!complete)
        {
            source.LastSyncedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync();
            return new(false, $"Hevy has more than {MaxPages * PageSize} workouts to read; imported {created + updated} so far. Sync again to continue.", created, updated, deleted);
        }

        // Next time, only what changed since this run began (a little overlap is harmless: upserts).
        await SaveSecret(db, CursorSecret, started.AddMinutes(-5).ToString("O"));
        source.LastSyncedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync();
        return new(true, null, created, updated, deleted);
    }

    /// <summary>A Hevy workout as an incoming workout (Strength, with every set).</summary>
    public static IncomingWorkout? ToIncoming(JsonElement w)
    {
        if (w.ValueKind != JsonValueKind.Object || Str(w, "id") is not string id) return null;
        if (!DateTimeOffset.TryParse(Str(w, "start_time"), out var start)) return null;
        DateTimeOffset? end = DateTimeOffset.TryParse(Str(w, "end_time"), out var e) ? e : null;
        var sets = new List<IncomingSet>();
        foreach (var ex in Array(w, "exercises"))
        {
            var exIndex = Int(ex, "index") ?? 0;
            var name = Str(ex, "title") ?? "Exercise";
            foreach (var s in Array(ex, "sets"))
                sets.Add(new IncomingSet(exIndex, name, Str(ex, "exercise_template_id"), Int(s, "index") ?? 0, Str(s, "type") ?? "normal",
                    Num(s, "weight_kg"), Int(s, "reps"), Num(s, "distance_meters"), Int(s, "duration_seconds"), Num(s, "rpe")));
        }
        var minutes = end is { } f ? (int)Math.Round(Math.Clamp((f - start).TotalMinutes, 0, 1440)) : 0;
        return new IncomingWorkout(id.Length <= 100 ? id : id[..100], "Strength", Str(w, "title"), start, end, minutes, null, null, null, sets);
    }

    static async Task<HttpResponseMessage> Send(HttpClient http, string key, string path)
    {
        var req = new HttpRequestMessage(HttpMethod.Get, Base + path);
        req.Headers.Add("api-key", key);
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        return await http.SendAsync(req);
    }

    static async Task SaveSecret(AppDbContext db, string key, string value)
    {
        var row = await db.AppSecrets.FirstOrDefaultAsync(s => s.Key == key);
        if (row is null) db.AppSecrets.Add(new AppSecret { Key = key, Value = value }); else row.Value = value;
        await db.SaveChangesAsync();
    }

    static List<JsonElement> Array(JsonElement o, string key) =>
        o.ValueKind == JsonValueKind.Object && o.TryGetProperty(key, out var a) && a.ValueKind == JsonValueKind.Array ? a.EnumerateArray().ToList() : new();
    static string? Str(JsonElement o, string key) =>
        o.ValueKind == JsonValueKind.Object && o.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
    static double? Num(JsonElement o, string key) =>
        o.ValueKind == JsonValueKind.Object && o.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetDouble(out var d) && double.IsFinite(d) ? d : null;
    static int? Int(JsonElement o, string key) => Num(o, key) is double d ? (int)Math.Round(d) : null;
}
