using Microsoft.EntityFrameworkCore;
using PersonalDashboard.Api.Data;
using PersonalDashboard.Api.Push;
using DbPushSubscription = PersonalDashboard.Api.Domain.PushSubscription;

namespace PersonalDashboard.Api.Endpoints;

public record PushKeysInput(string P256dh, string Auth);
public record PushSubscribeInput(string Endpoint, PushKeysInput Keys, string? TimeZone = null);
public record PushUnsubscribeInput(string Endpoint);
public record ReminderInput(int? Minutes);

// Habit reminders over Web Push: devices subscribe, habits get a reminder time.
public static partial class ApiEndpoints
{
    private static void MapPush(RouteGroupBuilder api)
    {
        // The public half of the server's VAPID key, which browsers need to subscribe.
        api.MapGet("/push/key", async (AppDbContext db) => new { publicKey = (await PushKeys.GetOrCreateAsync(db)).PublicKey });

        // Save (or refresh) a device's subscription and its current time zone.
        api.MapPost("/push/subscribe", async (PushSubscribeInput body, AppDbContext db, HttpRequest req) =>
        {
            if (string.IsNullOrWhiteSpace(body.Endpoint) || body.Endpoint.Length > 2048 || !body.Endpoint.StartsWith("https://", StringComparison.Ordinal)
                || string.IsNullOrWhiteSpace(body.Keys?.P256dh) || string.IsNullOrWhiteSpace(body.Keys?.Auth))
                return Results.BadRequest(new { message = "invalid push subscription" });
            var now = DateTimeOffset.UtcNow;
            var offset = ClientClock.From(req).OffsetMinutes;
            // Keep only a time zone this server recognises; otherwise the offset is used.
            var zone = body.TimeZone is { Length: > 0 and <= 64 } z && TimeZoneInfo.TryFindSystemTimeZoneById(z, out _) ? z : null;
            var sub = await db.PushSubscriptions.FirstOrDefaultAsync(s => s.Endpoint == body.Endpoint);
            if (sub is null)
                db.PushSubscriptions.Add(new DbPushSubscription
                {
                    Endpoint = body.Endpoint, P256dh = body.Keys.P256dh, Auth = body.Keys.Auth,
                    TzOffsetMinutes = offset, TimeZoneId = zone, CreatedAt = now, LastSeenAt = now,
                });
            else { sub.P256dh = body.Keys.P256dh; sub.Auth = body.Keys.Auth; sub.TzOffsetMinutes = offset; sub.TimeZoneId = zone ?? sub.TimeZoneId; sub.LastSeenAt = now; }
            await db.SaveChangesAsync();
            return Results.Ok(new { subscribed = true, devices = await db.PushSubscriptions.CountAsync() });
        });

        api.MapPost("/push/unsubscribe", async (PushUnsubscribeInput body, AppDbContext db) =>
        {
            await db.PushSubscriptions.Where(s => s.Endpoint == body.Endpoint).ExecuteDeleteAsync();
            return Results.NoContent();
        });

        // A test notification to every device, to check reminders will arrive.
        api.MapPost("/push/test", async (AppDbContext db, PushSender sender) =>
        {
            var sent = await sender.SendAsync(db, new PushSender.Note("Reminders are on", "This is how a habit reminder will look.", "/habits", "test"));
            return Results.Ok(new { sent });
        });

        // Set or clear a habit's reminder time (local minutes after midnight).
        api.MapPut("/habits/{id:int}/reminder", async (int id, ReminderInput body, AppDbContext db, HttpRequest req) =>
        {
            if (body.Minutes is int m && (m < 0 || m >= 24 * 60)) return Results.BadRequest(new { message = "minutes must be 0–1439" });
            var habit = await db.Habits.FindAsync(id);
            if (habit is null) return Results.NotFound();
            if (habit.ReminderMinutes != body.Minutes) habit.ReminderLastSentOn = null; // a new time can fire today
            habit.ReminderMinutes = body.Minutes;
            await db.SaveChangesAsync();
            return Results.Ok(new { habit = await HabitRowAsync(db, ClientClock.From(req).Today, id) });
        });
    }
}
