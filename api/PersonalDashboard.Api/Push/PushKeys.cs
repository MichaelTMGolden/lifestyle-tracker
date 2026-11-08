using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using PersonalDashboard.Api.Data;
using PersonalDashboard.Api.Domain;
using PersonalDashboard.Api.Integrations;

namespace PersonalDashboard.Api.Push;

/// <summary>
/// The server's VAPID key pair for Web Push. Generated on first use and kept in
/// AppSecrets (private key encrypted with SecretCrypto), so nothing has to be
/// configured by hand. If the private key can't be decrypted (the encryption
/// key changed), a new pair is made and old subscriptions are dropped, since
/// they were tied to the old public key; devices subscribe again on next use.
/// </summary>
public static class PushKeys
{
    private const string PublicKey = "push.vapid.public";
    private const string PrivateKey = "push.vapid.private";
    private static readonly SemaphoreSlim Gate = new(1, 1);

    public static async Task<(string PublicKey, string PrivateKey)> GetOrCreateAsync(AppDbContext db)
    {
        await Gate.WaitAsync();
        try
        {
            var pub = await db.AppSecrets.AsNoTracking().FirstOrDefaultAsync(s => s.Key == PublicKey);
            var priv = await db.AppSecrets.AsNoTracking().FirstOrDefaultAsync(s => s.Key == PrivateKey);
            var decrypted = priv is null ? null : SecretCrypto.Decrypt(priv.Value);
            if (pub is not null && decrypted is not null) return (pub.Value, decrypted);

            var (newPub, newPriv) = Generate();
            db.AppSecrets.RemoveRange(await db.AppSecrets.Where(s => s.Key == PublicKey || s.Key == PrivateKey).ToListAsync());
            // Replacing an unreadable pair: devices subscribed with the old public key can't be reached.
            if (pub is not null || priv is not null) db.PushSubscriptions.RemoveRange(await db.PushSubscriptions.ToListAsync());
            db.AppSecrets.Add(new AppSecret { Key = PublicKey, Value = newPub });
            db.AppSecrets.Add(new AppSecret { Key = PrivateKey, Value = SecretCrypto.Encrypt(newPriv) });
            await db.SaveChangesAsync();
            return (newPub, newPriv);
        }
        finally { Gate.Release(); }
    }

    /// <summary>A P-256 pair: public key as the uncompressed point, private as the scalar; both base64url.</summary>
    public static (string PublicKey, string PrivateKey) Generate()
    {
        using var ec = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var p = ec.ExportParameters(includePrivateParameters: true);
        var point = new byte[65];
        point[0] = 0x04;
        p.Q.X!.CopyTo(point, 1);
        p.Q.Y!.CopyTo(point, 33);
        return (Base64Url(point), Base64Url(p.D!));
    }

    private static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
