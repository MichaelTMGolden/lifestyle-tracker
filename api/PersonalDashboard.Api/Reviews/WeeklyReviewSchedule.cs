using Microsoft.EntityFrameworkCore;
using PersonalDashboard.Api.Alerts;
using PersonalDashboard.Api.Data;
using PersonalDashboard.Api.Push;

namespace PersonalDashboard.Api.Reviews;

/// <summary>
/// Writes last week's review on Monday morning (local time) and sends a
/// notification when it's ready. Only runs once an Anthropic API key is set.
/// </summary>
public class WeeklyReviewSchedule(IServiceScopeFactory scopes, ILogger<WeeklyReviewSchedule> log) : BackgroundService
{
    /// <summary>Local hour on Monday after which last week's review is written.</summary>
    public const int Hour = 8;

    /// <summary>The completed week to review now, or null if it isn't time yet. Pure, for tests.</summary>
    public static DateOnly? WeekDue(DateTime localNow, bool alreadyReviewed)
    {
        if (alreadyReviewed) return null;
        var today = DateOnly.FromDateTime(localNow);
        var thisMonday = today.AddDays(-(((int)today.DayOfWeek + 6) % 7));
        // Any time from Monday 08:00 onward (so a late start still catches up within the week).
        if (today == thisMonday && localNow.Hour < Hour) return null;
        return thisMonday.AddDays(-7);
    }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        try { await Task.Delay(TimeSpan.FromMinutes(1), ct); } catch { return; }
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(15));
        do
        {
            try { await RunOnceAsync(DateTime.UtcNow, ct); }
            catch (Exception ex) when (!ct.IsCancellationRequested) { log.LogWarning(ex, "Weekly review schedule failed."); }
        }
        while (await timer.WaitForNextTickAsync(ct));
    }

    public async Task RunOnceAsync(DateTime utcNow, CancellationToken ct = default)
    {
        using var scope = scopes.CreateScope();
        var reviews = scope.ServiceProvider.GetRequiredService<ReviewSynthesisService>();
        if (!reviews.IsEnabled) return;
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var clock = await DeviceClock.CurrentAsync(db, utcNow, ct);
        var lastWeek = WeekDue(clock.LocalNow, alreadyReviewed: false)!.Value;
        // A failed attempt doesn't count: try again on the next tick.
        var done = await db.WeeklyReviews.AnyAsync(r => r.WeekStart == lastWeek && r.Status == "Generated", ct);
        if (WeekDue(clock.LocalNow, done) is not DateOnly week) return;
        // After a failed attempt (bad key, outage), wait a while instead of retrying every tick.
        var since = new DateTimeOffset(utcNow, TimeSpan.Zero).AddHours(-6);
        if (await db.WeeklyReviews.AnyAsync(r => r.WeekStart == week && r.Status == "Failed" && r.CreatedAt > since, ct)) return;

        await scope.ServiceProvider.GetRequiredService<AlertService>().GenerateIfStaleAsync(db, clock, ct);
        var review = await reviews.GenerateForWeekAsync(db, week, clock.Today, ct);
        log.LogInformation("Weekly review for {Week}: {Status}.", week, review.Status);
        if (review.Status != "Generated") return;
        await scope.ServiceProvider.GetRequiredService<PushSender>().SendAsync(db,
            new PushSender.Note("Your weekly summary is ready", review.Narrative ?? "See how last week went.", "/health", "weekly-review"), ct);
    }
}
