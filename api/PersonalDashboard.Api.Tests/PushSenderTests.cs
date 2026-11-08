using System.Net;
using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using PersonalDashboard.Api.Data;
using PersonalDashboard.Api.Domain;
using PersonalDashboard.Api.Push;
using Xunit;

namespace PersonalDashboard.Api.Tests;

/// <summary>Delivery against a fake push service: encrypted, VAPID-signed, and gone devices forgotten.</summary>
public class PushSenderTests
{
    private sealed class FakePushService(HttpStatusCode status) : HttpMessageHandler
    {
        public List<(HttpRequestMessage Request, byte[] Body, string? Encoding)> Requests { get; } = [];
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            // Read the body now: the client disposes it once the request completes.
            var body = request.Content is null ? [] : await request.Content.ReadAsByteArrayAsync(ct);
            Requests.Add((request, body, request.Content?.Headers.ContentEncoding.SingleOrDefault()));
            return new HttpResponseMessage(status);
        }
    }
    private sealed class Factory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }

    private static string B64Url(byte[] b) => Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    /// <summary>Keys a real browser would hand over: a P-256 public point and a 16-byte auth secret.</summary>
    private static PushSubscription Device(string endpoint)
    {
        using var ecdh = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
        var q = ecdh.ExportParameters(false).Q;
        var point = new byte[65]; point[0] = 4; q.X!.CopyTo(point, 1); q.Y!.CopyTo(point, 33);
        return new PushSubscription { Endpoint = endpoint, P256dh = B64Url(point), Auth = B64Url(RandomNumberGenerator.GetBytes(16)) };
    }

    private static async Task<AppDbContext> Database(params PushSubscription[] devices)
    {
        var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning)).Options);
        db.PushSubscriptions.AddRange(devices);
        await db.SaveChangesAsync();
        return db;
    }

    private static PushSender Sender(HttpMessageHandler handler) =>
        new(new Factory(handler), new ConfigurationBuilder().Build(), NullLogger<PushSender>.Instance);

    [Fact]
    public async Task Sends_an_encrypted_vapid_signed_message_to_each_device()
    {
        var push = new FakePushService(HttpStatusCode.Created);
        await using var db = await Database(Device("https://push.example/a"), Device("https://push.example/b"));
        var sent = await Sender(push).SendAsync(db, new PushSender.Note("Guitar", "Not logged yet today.", "/habits", "habit-2"));

        Assert.Equal(2, sent);
        Assert.Equal(["https://push.example/a", "https://push.example/b"], push.Requests.Select(r => r.Request.RequestUri!.ToString()).ToArray());
        var (r, body, encoding) = push.Requests[0];
        Assert.StartsWith("vapid ", r.Headers.Authorization?.ToString(), StringComparison.OrdinalIgnoreCase);
        Assert.Equal("aes128gcm", encoding);
        Assert.NotEmpty(body);
        Assert.DoesNotContain("Not logged yet", System.Text.Encoding.UTF8.GetString(body)); // payload is encrypted
        Assert.Equal(2, await db.PushSubscriptions.CountAsync());
    }

    [Fact]
    public async Task A_device_the_push_service_reports_gone_is_forgotten()
    {
        var push = new FakePushService(HttpStatusCode.Gone);
        await using var db = await Database(Device("https://push.example/old"));
        var sent = await Sender(push).SendAsync(db, new PushSender.Note("Guitar", "x", "/habits", "habit-2"));
        Assert.Equal(0, sent);
        Assert.Empty(await db.PushSubscriptions.ToListAsync());
    }

    [Fact]
    public async Task No_devices_means_nothing_is_sent()
    {
        var push = new FakePushService(HttpStatusCode.Created);
        await using var db = await Database();
        Assert.Equal(0, await Sender(push).SendAsync(db, new PushSender.Note("t", "b", "/", "x")));
        Assert.Empty(push.Requests);
    }
}
