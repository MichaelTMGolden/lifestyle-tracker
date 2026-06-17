using Microsoft.Extensions.Configuration;
using PersonalDashboard.Api.Data;
using PersonalDashboard.Api.Endpoints;

namespace PersonalDashboard.Api.Integrations;

/// <summary>
/// Periodically syncs every connected source in the background — Garmin (via the
/// sidecar) and Google Calendar (iCal feeds). Each no-ops quietly while not
/// connected. Interval defaults to 1h; override with SYNC_HOURS (fractions ok,
/// e.g. 0.5 = 30 min). GARMIN_SYNC_HOURS is honoured as a fallback for
/// back-compat. Set to 0 to disable.
/// </summary>
public class ConnectionsAutoSync : BackgroundService
{
    private readonly IServiceScopeFactory _scopes;
    private readonly IHttpClientFactory _http;
    private readonly IConfiguration _cfg;
    private readonly ILogger<ConnectionsAutoSync> _log;

    public ConnectionsAutoSync(IServiceScopeFactory scopes, IHttpClientFactory http, IConfiguration cfg, ILogger<ConnectionsAutoSync> log)
        => (_scopes, _http, _cfg, _log) = (scopes, http, cfg, log);

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        var raw = _cfg["Sync:Hours"] ?? Environment.GetEnvironmentVariable("SYNC_HOURS")
                  ?? Environment.GetEnvironmentVariable("GARMIN_SYNC_HOURS");
        var hours = double.TryParse(raw, out var h) ? h : 1.0;
        if (hours <= 0) { _log.LogInformation("Auto-sync disabled (SYNC_HOURS=0)."); return; }
        var interval = TimeSpan.FromHours(hours);
        _log.LogInformation("Connections auto-sync every {Hours}h.", hours);

        // Let the app + sidecar finish starting before the first run.
        try { await Task.Delay(TimeSpan.FromSeconds(20), ct); } catch { return; }

        using var timer = new PeriodicTimer(interval);
        do { await RunOnceAsync(); }
        while (await timer.WaitForNextTickAsync(ct));
    }

    private async Task RunOnceAsync()
    {
        using var scope = _scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        // Garmin — a few days each run covers late backfill (e.g. sleep finalising).
        try
        {
            var (ok, err, written) = await GarminSyncService.SyncStoredAsync(db, _http, _cfg, days: 3);
            if (ok) _log.LogInformation("Auto-sync · Garmin: {Written} samples.", written);
            else if (err is not null) _log.LogWarning("Auto-sync · Garmin failed: {Error}", err);
        }
        catch (Exception ex) { _log.LogWarning(ex, "Auto-sync · Garmin error."); }

        // Google Calendar — refetch every connected feed.
        try
        {
            var (events, failures, configured) = await ApiEndpoints.SyncGoogleStoredAsync(db, _http);
            if (configured) _log.LogInformation("Auto-sync · Google: {Events} events{Failed}.",
                events, failures.Count > 0 ? $" ({failures.Count} feed failed)" : "");
        }
        catch (Exception ex) { _log.LogWarning(ex, "Auto-sync · Google error."); }
    }
}
