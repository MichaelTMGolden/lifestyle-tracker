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

// Alerts from anomaly and pattern detection.
public static partial class ApiEndpoints
{
    private static int SeverityRank(string severity) => severity switch
    {
        "Urgent" => 3, "Watch" => 2, "Info" => 1, _ => 0,
    };

    internal static async Task<List<Alert>> ActiveAlertsAsync(AppDbContext db, AlertService alerts, ClientClock clock, string? status)
    {
        await alerts.GenerateIfStaleAsync(db, clock);
        var query = db.Alerts.AsNoTracking();
        if (status != "all") query = query.Where(a => a.Status != "Dismissed");
        var list = await query.ToListAsync();
        return list.OrderByDescending(a => SeverityRank(a.Severity)).ThenByDescending(a => a.DetectedAt).ToList();
    }

    private static void MapAlerts(RouteGroupBuilder api)
    {
        // --- Alerts (anomaly / pattern detection) ---
        // GET runs a staleness-guarded regeneration (≤ once/hour); refresh forces it.
        api.MapGet("/alerts", async (AppDbContext db, AlertService alerts, HttpRequest req, string? status) => await ActiveAlertsAsync(db, alerts, ClientClock.From(req), status));

        api.MapPost("/alerts/refresh", async (AppDbContext db, AlertService alerts, HttpRequest req) =>
        {
            await alerts.GenerateAlertsAsync(db, ClientClock.From(req));
            var list = await db.Alerts.AsNoTracking().Where(a => a.Status != "Dismissed").ToListAsync();
            return Results.Ok(list.OrderByDescending(a => SeverityRank(a.Severity)).ThenByDescending(a => a.DetectedAt));
        });

        api.MapPost("/alerts/{id:long}/dismiss", async (long id, AppDbContext db) =>
        {
            var a = await db.Alerts.FindAsync(id);
            if (a is null) return Results.NotFound();
            a.Status = "Dismissed";
            a.DismissedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync();
            return Results.NoContent();
        });
    }
}
