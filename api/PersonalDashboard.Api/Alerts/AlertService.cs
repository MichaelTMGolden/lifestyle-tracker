using Microsoft.EntityFrameworkCore;
using PersonalDashboard.Api.Data;
using PersonalDashboard.Api.Domain;

namespace PersonalDashboard.Api.Alerts;

/// <summary>Inputs a detector needs. Detectors are stateless singletons; per-run state lives here.</summary>
public record AlertContext(AppDbContext Db, DateOnly Today, DateTimeOffset Now);

/// <summary>
/// One detector = one alert family. Add a detector + register it in DI and it joins
/// the run automatically (a one-file change). Detectors must be side-effect free —
/// they return candidate Alerts; the service persists/dedupes/auto-resolves.
/// </summary>
public interface IAlertDetector
{
    Task<IEnumerable<Alert>> DetectAsync(AlertContext ctx, CancellationToken ct = default);
}

/// <summary>
/// Runs all detectors and reconciles the result with stored alerts:
/// upsert by DedupeKey, and auto-resolve (dismiss) any New/Seen alert whose
/// condition no longer holds. Singleton so the once-per-hour staleness guard
/// survives across requests; a future scheduled job can call GenerateAlertsAsync
/// with no changes.
/// </summary>
public class AlertService
{
    private static readonly TimeSpan StaleAfter = TimeSpan.FromHours(1);
    private readonly IEnumerable<IAlertDetector> _detectors;
    private readonly ILogger<AlertService> _log;
    private readonly SemaphoreSlim _lock = new(1, 1);
    private DateTimeOffset? _lastRun;

    public AlertService(IEnumerable<IAlertDetector> detectors, ILogger<AlertService> log)
    {
        _detectors = detectors;
        _log = log;
    }

    public async Task GenerateIfStaleAsync(AppDbContext db, ClientClock clock, CancellationToken ct = default)
    {
        if (_lastRun is null || clock.UtcNow - _lastRun > StaleAfter)
            await GenerateAlertsAsync(db, clock, ct);
    }

    public async Task GenerateAlertsAsync(AppDbContext db, ClientClock clock, CancellationToken ct = default)
    {
        await _lock.WaitAsync(ct);
        try
        {
            var ctx = new AlertContext(db, clock.Today, clock.UtcNow);
            var produced = new List<Alert>();
            foreach (var detector in _detectors)
            {
                try { produced.AddRange(await detector.DetectAsync(ctx, ct)); }
                catch (Exception ex) { _log.LogWarning(ex, "Alert detector {Detector} failed", detector.GetType().Name); }
            }

            var producedKeys = produced.Select(a => a.DedupeKey).ToHashSet();
            var existing = await db.Alerts.ToDictionaryAsync(a => a.DedupeKey, ct);

            foreach (var a in produced)
            {
                if (existing.TryGetValue(a.DedupeKey, out var e))
                {
                    // Refresh content; preserve Status so a user-dismissed alert stays dismissed.
                    e.Severity = a.Severity; e.Title = a.Title; e.Detail = a.Detail;
                    e.Value = a.Value; e.ExpectedLow = a.ExpectedLow; e.ExpectedHigh = a.ExpectedHigh;
                    e.ForDate = a.ForDate; e.DetectedAt = a.DetectedAt;
                }
                else
                {
                    db.Alerts.Add(a);
                }
            }

            // Self-clean: conditions that no longer hold this run → auto-resolve.
            foreach (var e in existing.Values)
            {
                if ((e.Status == "New" || e.Status == "Seen") && !producedKeys.Contains(e.DedupeKey))
                {
                    e.Status = "Dismissed";
                    e.DismissedAt = clock.UtcNow;
                }
            }

            await db.SaveChangesAsync(ct);
            _lastRun = clock.UtcNow;
        }
        finally { _lock.Release(); }
    }
}
