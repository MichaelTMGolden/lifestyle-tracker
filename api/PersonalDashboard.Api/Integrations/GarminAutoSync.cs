using Microsoft.Extensions.Configuration;
using PersonalDashboard.Api.Data;

namespace PersonalDashboard.Api.Integrations;

/// <summary>
/// Periodically syncs Garmin in the background (default every 6h) using the
/// stored credentials. No-ops while Garmin isn't connected. Interval is
/// overridable via GARMIN_SYNC_HOURS (e.g. for testing); set to 0 to disable.
/// </summary>
public class GarminAutoSync : BackgroundService
{
    private readonly IServiceScopeFactory _scopes;
    private readonly IHttpClientFactory _http;
    private readonly IConfiguration _cfg;
    private readonly ILogger<GarminAutoSync> _log;

    public GarminAutoSync(IServiceScopeFactory scopes, IHttpClientFactory http, IConfiguration cfg, ILogger<GarminAutoSync> log)
        => (_scopes, _http, _cfg, _log) = (scopes, http, cfg, log);

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        var hours = ParseHours(_cfg["Garmin:AutoSyncHours"] ?? Environment.GetEnvironmentVariable("GARMIN_SYNC_HOURS"), 6);
        if (hours <= 0) { _log.LogInformation("Garmin auto-sync disabled (GARMIN_SYNC_HOURS=0)."); return; }
        var interval = TimeSpan.FromHours(hours);
        _log.LogInformation("Garmin auto-sync every {Hours}h.", hours);

        // Let the app + sidecar finish starting before the first run.
        try { await Task.Delay(TimeSpan.FromSeconds(20), ct); } catch { return; }

        using var timer = new PeriodicTimer(interval);
        do { await RunOnceAsync(ct); }
        while (await timer.WaitForNextTickAsync(ct));
    }

    private async Task RunOnceAsync(CancellationToken ct)
    {
        try
        {
            using var scope = _scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            // A few days each run covers Garmin backfilling late data (e.g. sleep finalising).
            var (ok, err, written) = await GarminSyncService.SyncStoredAsync(db, _http, _cfg, days: 3);
            if (ok) _log.LogInformation("Garmin auto-sync: upserted {Written} samples.", written);
            else if (err is not null) _log.LogWarning("Garmin auto-sync failed: {Error}", err);
            // err == null → not connected; stay quiet.
        }
        catch (Exception ex) { _log.LogWarning(ex, "Garmin auto-sync error."); }
    }

    private static double ParseHours(string? raw, double fallback) =>
        double.TryParse(raw, out var h) ? h : fallback;
}
