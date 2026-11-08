using Microsoft.EntityFrameworkCore;
using PersonalDashboard.Api.Data;

namespace PersonalDashboard.Api.Push;

/// <summary>
/// "Now" for background jobs, in the user's time zone: taken from the most
/// recently seen notification device (a single-user dashboard). With no device
/// yet, UTC.
/// </summary>
public static class DeviceClock
{
    public static async Task<ClientClock> CurrentAsync(AppDbContext db, DateTime utcNow, CancellationToken ct = default)
    {
        var device = await db.PushSubscriptions.AsNoTracking().OrderByDescending(s => s.LastSeenAt).FirstOrDefaultAsync(ct);
        if (device is null) return new ClientClock(0) { UtcNow = utcNow };
        var local = ReminderPolicy.LocalNow(utcNow, device.TimeZoneId, device.TzOffsetMinutes);
        // ClientClock's offset is getTimezoneOffset-style: minutes of UTC minus local.
        var offset = (int)Math.Round((utcNow - local).TotalMinutes);
        return new ClientClock(offset) { UtcNow = utcNow };
    }
}
