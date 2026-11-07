using PersonalDashboard.Api.Alerts;
using PersonalDashboard.Api.Data;
using PersonalDashboard.Api.Reviews;

namespace PersonalDashboard.Api.Endpoints;

/// <summary>
/// Everything the Today page needs in one request. It used to make nine calls
/// on every load and after every tap; on a phone over a slow connection those
/// queue behind one another. Each section is built by the same method its own
/// endpoint uses, so the bundle can't drift from the individual routes.
/// </summary>
public static class TodayBundleEndpoints
{
    public static RouteGroupBuilder MapTodayBundleEndpoints(this RouteGroupBuilder api)
    {
        api.MapGet("/today/bundle", Bundle);
        return api;
    }

    public static async Task<IResult> Bundle(
        AppDbContext db, HttpRequest req, AlertService alerts, ReviewSynthesisService reviews, ILoggerFactory loggers)
    {
        // One clock for every section, so they all agree on what "today" is.
        var clock = ClientClock.From(req);
        var log = loggers.CreateLogger("TodayBundle");

        // EF Core runs one query at a time per context, so these are sequential.
        var today = await ApiEndpoints.TodaySummaryAsync(db, clock);
        var schedule = await ApiEndpoints.ScheduleTodayAsync(db, clock);
        var habits = await ApiEndpoints.HabitRowsAsync(db, clock.Today);
        var heatmap = await ApiEndpoints.HabitHeatmapAsync(db, clock.Today, 30);
        var todos = await ApiEndpoints.TodosAsync(db);
        var dailyTodos = await ApiEndpoints.DailyTodosAsync(db, clock.Today);
        var pending = await DailyPlanningEndpoints.PendingAsync(db, clock.Today);

        // Alerts and the review are extras: the page used to load without them
        // when they failed, and it still should.
        object alertList;
        try { alertList = await ApiEndpoints.ActiveAlertsAsync(db, alerts, clock, null); }
        catch (Exception ex)
        {
            log.LogWarning(ex, "Today bundle: alerts unavailable");
            db.ChangeTracker.Clear();
            alertList = Array.Empty<object>();
        }
        object review;
        try { review = await ApiEndpoints.LatestReviewAsync(db, reviews); }
        catch (Exception ex)
        {
            log.LogWarning(ex, "Today bundle: latest review unavailable");
            review = new { enabled = false, review = (object?)null };
        }

        return Results.Ok(new { today, schedule, habits, heatmap, todos, dailyTodos, pending, alerts = alertList, review });
    }
}
