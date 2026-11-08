using Microsoft.EntityFrameworkCore;
using PersonalDashboard.Api.Data;

namespace PersonalDashboard.Api.Push;

/// <summary>
/// Once a minute: for each habit with a reminder time that has passed today
/// (in the device's local time) and isn't done yet, send one notification.
/// </summary>
public class ReminderService(IServiceScopeFactory scopes, ILogger<ReminderService> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        try { await Task.Delay(TimeSpan.FromSeconds(30), ct); } catch { return; }
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1));
        do
        {
            try { await RunOnceAsync(DateTime.UtcNow, ct); }
            catch (Exception ex) when (!ct.IsCancellationRequested) { log.LogWarning(ex, "Reminder check failed."); }
        }
        while (await timer.WaitForNextTickAsync(ct));
    }

    public async Task RunOnceAsync(DateTime utcNow, CancellationToken ct = default)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        // The devices' time zone: the most recently seen one (a single-user dashboard).
        var device = await db.PushSubscriptions.AsNoTracking().OrderByDescending(s => s.LastSeenAt).FirstOrDefaultAsync(ct);
        if (device is null) return;
        var localNow = utcNow.AddMinutes(-device.TzOffsetMinutes);
        var today = DateOnly.FromDateTime(localNow);

        var habits = await db.Habits.Where(h => !h.Archived && h.ReminderMinutes != null).ToListAsync(ct);
        if (habits.Count == 0) return;
        var ids = habits.Select(h => h.Id).ToList();
        var done = (await db.HabitLogs.AsNoTracking().Where(l => ids.Contains(l.HabitId) && l.Date == today && l.Completed)
            .Select(l => l.HabitId).ToListAsync(ct)).ToHashSet();

        var sender = scope.ServiceProvider.GetRequiredService<PushSender>();
        foreach (var h in habits.Where(h => ReminderPolicy.IsDue(h.ReminderMinutes, h.ReminderLastSentOn, done.Contains(h.Id), localNow)))
        {
            var sent = await sender.SendAsync(db, new PushSender.Note(h.Name, $"Not logged yet today. Tap to log {h.Name}.", "/habits", $"habit-{h.Id}"), ct);
            if (sent == 0 && !await db.PushSubscriptions.AnyAsync(ct)) return; // every device unsubscribed
            h.ReminderLastSentOn = today; // at most once a day, even if a device was briefly unreachable
            await db.SaveChangesAsync(ct);
            log.LogInformation("Reminder for {Habit} sent to {Devices} device(s).", h.Name, sent);
        }
    }
}
