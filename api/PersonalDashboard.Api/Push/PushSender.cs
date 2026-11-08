using System.Net;
using System.Text.Json;
using Lib.Net.Http.WebPush;
using Lib.Net.Http.WebPush.Authentication;
using Microsoft.EntityFrameworkCore;
using PersonalDashboard.Api.Data;
using WebPushSubscription = Lib.Net.Http.WebPush.PushSubscription;

namespace PersonalDashboard.Api.Push;

/// <summary>Sends a notification to every subscribed device; forgets devices whose subscription is gone.</summary>
public class PushSender(IHttpClientFactory http, IConfiguration cfg, ILogger<PushSender> log)
{
    public record Note(string Title, string Body, string Url, string Tag);

    /// <summary>Returns how many devices accepted it.</summary>
    public async Task<int> SendAsync(AppDbContext db, Note note, CancellationToken ct = default)
    {
        // Keys first: replacing an unreadable pair drops the old subscriptions.
        var (pub, priv) = await PushKeys.GetOrCreateAsync(db);
        var subs = await db.PushSubscriptions.ToListAsync(ct);
        if (subs.Count == 0) return 0;
        // A contact for push services; the site's own address, never a personal one.
        var subject = cfg["Push:Subject"] ?? Environment.GetEnvironmentVariable("PUSH_SUBJECT") ?? "https://personal-dashboard-bizi.onrender.com";
        var client = new PushServiceClient(http.CreateClient("push"))
        {
            DefaultAuthentication = new VapidAuthentication(pub, priv) { Subject = subject },
        };
        var message = new PushMessage(JsonSerializer.Serialize(new { title = note.Title, body = note.Body, url = note.Url, tag = note.Tag }))
        {
            Topic = note.Tag.Length <= 32 ? note.Tag : null,
            TimeToLive = 6 * 60 * 60,
            Urgency = PushMessageUrgency.Normal,
        };

        var delivered = 0;
        foreach (var s in subs)
        {
            var target = new WebPushSubscription { Endpoint = s.Endpoint };
            target.SetKey(PushEncryptionKeyName.P256DH, s.P256dh);
            target.SetKey(PushEncryptionKeyName.Auth, s.Auth);
            try { await client.RequestPushMessageDeliveryAsync(target, message, ct); delivered++; }
            catch (PushServiceClientException ex) when (ex.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.Gone)
            {
                db.PushSubscriptions.Remove(s); // unsubscribed or expired on the device
            }
            catch (Exception ex) { log.LogWarning(ex, "Push to one device failed."); }
        }
        await db.SaveChangesAsync(ct);
        return delivered;
    }
}
