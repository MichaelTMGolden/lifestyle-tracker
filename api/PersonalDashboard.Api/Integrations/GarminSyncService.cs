using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using PersonalDashboard.Api.Data;
using PersonalDashboard.Api.Domain;

namespace PersonalDashboard.Api.Integrations;

/// <summary>
/// Garmin sync via the Python sidecar. Shared by the /connections/garmin endpoints
/// (manual "Sync now", credential verify) and the GarminAutoSync background job.
/// </summary>
public static class GarminSyncService
{
    public const string LiveSourceName = "Garmin (live)";

    public record GarminSample(string Key, DateTimeOffset At, double Value, string? Unit);
    private record PullPayload(int Count, List<GarminSample> Samples);

    /// <summary>Call the sidecar's /pull. Returns (ok, error, samples).</summary>
    public static async Task<(bool Ok, string? Error, List<GarminSample>? Samples)> PullAsync(
        IHttpClientFactory httpFactory, IConfiguration cfg, string email, string password, int days, string? end)
    {
        var baseUrl = (cfg["Sidecar:Url"] ?? Environment.GetEnvironmentVariable("SIDECAR_URL") ?? "http://localhost:8001").TrimEnd('/');
        var token = cfg["Sidecar:Token"] ?? Environment.GetEnvironmentVariable("SIDECAR_TOKEN");
        try
        {
            var http = httpFactory.CreateClient();
            http.Timeout = TimeSpan.FromMinutes(5);
            using var req = new HttpRequestMessage(HttpMethod.Post, $"{baseUrl}/pull")
            {
                Content = JsonContent.Create(new { email, password, days, end }),
            };
            if (!string.IsNullOrEmpty(token)) req.Headers.Add("X-Sidecar-Token", token);
            using var resp = await http.SendAsync(req);
            if (!resp.IsSuccessStatusCode)
            {
                var detail = await resp.Content.ReadAsStringAsync();
                return (false, $"sidecar {(int)resp.StatusCode}: {detail[..Math.Min(detail.Length, 300)]}", null);
            }
            var payload = await resp.Content.ReadFromJsonAsync<PullPayload>();
            return (true, null, payload?.Samples ?? new());
        }
        catch (Exception ex)
        {
            return (false, $"sidecar unreachable: {ex.Message}", null);
        }
    }

    /// <summary>Upsert pulled samples under the "Garmin (live)" source. Idempotent.</summary>
    public static async Task<int> UpsertAsync(AppDbContext db, List<GarminSample> input)
    {
        var source = await db.DataSources.FirstOrDefaultAsync(s => s.Kind == SourceKind.Garmin && s.Name == LiveSourceName);
        if (source is null)
        {
            source = new DataSource { Name = LiveSourceName, Kind = SourceKind.Garmin };
            db.DataSources.Add(source);
            await db.SaveChangesAsync();
        }
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

    /// <summary>Full sync using stored credentials. Returns (ok, error, written).
    /// (false, null, 0) means "not configured" — a no-op, not an error.</summary>
    public static async Task<(bool Ok, string? Error, int Written)> SyncStoredAsync(
        AppDbContext db, IHttpClientFactory http, IConfiguration cfg, int days)
    {
        var email = (await db.AppSecrets.AsNoTracking().FirstOrDefaultAsync(s => s.Key == "garmin.email"))?.Value;
        var pwEnc = (await db.AppSecrets.AsNoTracking().FirstOrDefaultAsync(s => s.Key == "garmin.pw"))?.Value;
        if (email is null || pwEnc is null) return (false, null, 0); // not connected — skip quietly
        var pw = SecretCrypto.Decrypt(pwEnc);
        if (pw is null) return (false, "stored credentials can't be decrypted", 0);

        var (ok, err, samples) = await PullAsync(http, cfg, email, pw, days, null);
        if (!ok) return (false, err, 0);
        var written = await UpsertAsync(db, samples!);
        return (true, null, written);
    }
}
