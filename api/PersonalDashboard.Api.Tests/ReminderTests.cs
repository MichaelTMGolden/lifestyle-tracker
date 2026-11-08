using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using PersonalDashboard.Api.Data;
using PersonalDashboard.Api.Domain;
using PersonalDashboard.Api.Push;
using Xunit;

namespace PersonalDashboard.Api.Tests;

public class ReminderTests
{
    private static readonly DateTime Evening = new(2026, 11, 8, 19, 30, 0);

    [Fact]
    public void Due_after_the_time_when_not_done_and_not_yet_sent_today()
    {
        Assert.True(ReminderPolicy.IsDue(19 * 60, null, doneToday: false, Evening));
        Assert.True(ReminderPolicy.IsDue(19 * 60 + 30, new DateOnly(2026, 11, 7), false, Evening)); // exactly on time, sent yesterday
    }

    [Fact]
    public void Not_due_before_the_time_when_done_already_sent_or_unset()
    {
        Assert.False(ReminderPolicy.IsDue(20 * 60, null, false, Evening));
        Assert.False(ReminderPolicy.IsDue(19 * 60, null, doneToday: true, Evening));
        Assert.False(ReminderPolicy.IsDue(19 * 60, new DateOnly(2026, 11, 8), false, Evening));
        Assert.False(ReminderPolicy.IsDue(null, null, false, Evening));
        Assert.False(ReminderPolicy.IsDue(24 * 60, null, false, Evening));
    }

    [Fact]
    public void Local_time_follows_daylight_saving_with_a_named_zone()
    {
        // New York: EDT (UTC-4) until 1 Nov 2026 02:00, then EST (UTC-5). The device last reported EDT (240).
        var afterChange = new DateTime(2026, 11, 2, 0, 0, 0, DateTimeKind.Utc); // 19:00 EST on 1 Nov
        Assert.Equal(new DateTime(2026, 11, 1, 19, 0, 0), ReminderPolicy.LocalNow(afterChange, "America/New_York", 240));
        // Without a zone the stale offset is all there is (an hour off), which is why the zone is stored.
        Assert.Equal(new DateTime(2026, 11, 1, 20, 0, 0), ReminderPolicy.LocalNow(afterChange, null, 240));
        Assert.Equal(new DateTime(2026, 11, 1, 20, 0, 0), ReminderPolicy.LocalNow(afterChange, "Not/AZone", 240));
    }

    [Fact]
    public void Generated_keys_are_a_valid_p256_pair()
    {
        var (pub, priv) = PushKeys.Generate();
        var point = FromBase64Url(pub);
        var d = FromBase64Url(priv);
        Assert.Equal(65, point.Length);
        Assert.Equal(0x04, point[0]);
        Assert.Equal(32, d.Length);
        // The private scalar must reproduce the public point.
        using var ec = ECDsa.Create(new ECParameters { Curve = ECCurve.NamedCurves.nistP256, D = d });
        var q = ec.ExportParameters(false).Q;
        Assert.Equal(point[1..33], q.X);
        Assert.Equal(point[33..], q.Y);
    }

    [Fact]
    public async Task Keys_are_created_once_stored_encrypted_and_reused()
    {
        await using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning)).Options);
        var first = await PushKeys.GetOrCreateAsync(db);
        var second = await PushKeys.GetOrCreateAsync(db);
        Assert.Equal(first, second);
        var stored = await db.AppSecrets.SingleAsync(s => s.Key == "push.vapid.private");
        Assert.NotEqual(first.PrivateKey, stored.Value); // encrypted at rest
    }

    [Fact]
    public async Task Unreadable_private_key_regenerates_the_pair_and_drops_old_subscriptions()
    {
        await using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning)).Options);
        db.AppSecrets.Add(new AppSecret { Key = "push.vapid.public", Value = "old" });
        db.AppSecrets.Add(new AppSecret { Key = "push.vapid.private", Value = "not-decryptable" });
        db.PushSubscriptions.Add(new PushSubscription { Endpoint = "https://push.example/1", P256dh = "x", Auth = "y" });
        await db.SaveChangesAsync();
        var keys = await PushKeys.GetOrCreateAsync(db);
        Assert.NotEqual("old", keys.PublicKey);
        Assert.Empty(await db.PushSubscriptions.ToListAsync());
    }

    [Fact]
    public async Task First_key_creation_keeps_existing_subscriptions()
    {
        await using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning)).Options);
        db.PushSubscriptions.Add(new PushSubscription { Endpoint = "https://push.example/1", P256dh = "x", Auth = "y" });
        await db.SaveChangesAsync();
        await PushKeys.GetOrCreateAsync(db);
        Assert.Single(await db.PushSubscriptions.ToListAsync());
    }

    private static byte[] FromBase64Url(string s)
    {
        s = s.Replace('-', '+').Replace('_', '/');
        return Convert.FromBase64String(s.PadRight(s.Length + (4 - s.Length % 4) % 4, '='));
    }
}
