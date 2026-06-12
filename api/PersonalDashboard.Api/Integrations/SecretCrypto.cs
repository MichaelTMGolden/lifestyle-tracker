using System.Security.Cryptography;
using System.Text;

namespace PersonalDashboard.Api.Integrations;

/// <summary>
/// AES-GCM encryption for at-rest secrets (the Garmin password). The key is
/// derived from an environment variable so it survives restarts/redeploys on
/// ephemeral hosts (unlike Data Protection keys on a throwaway filesystem).
/// Set GARMIN_ENC_KEY in production; falls back to APP_PASSWORD, then a dev key.
/// </summary>
public static class SecretCrypto
{
    private static byte[] Key()
    {
        var basis = Environment.GetEnvironmentVariable("GARMIN_ENC_KEY")
                    ?? Environment.GetEnvironmentVariable("APP_PASSWORD")
                    ?? "pd-dev-insecure-key";
        return SHA256.HashData(Encoding.UTF8.GetBytes("pd-secret::" + basis));
    }

    public static string Encrypt(string plain)
    {
        var nonce = RandomNumberGenerator.GetBytes(AesGcm.NonceByteSizes.MaxSize);
        var pt = Encoding.UTF8.GetBytes(plain);
        var ct = new byte[pt.Length];
        var tag = new byte[AesGcm.TagByteSizes.MaxSize];
        using var aes = new AesGcm(Key(), tag.Length);
        aes.Encrypt(nonce, pt, ct, tag);
        var blob = new byte[nonce.Length + tag.Length + ct.Length];
        Buffer.BlockCopy(nonce, 0, blob, 0, nonce.Length);
        Buffer.BlockCopy(tag, 0, blob, nonce.Length, tag.Length);
        Buffer.BlockCopy(ct, 0, blob, nonce.Length + tag.Length, ct.Length);
        return Convert.ToBase64String(blob);
    }

    public static string? Decrypt(string b64)
    {
        try
        {
            var blob = Convert.FromBase64String(b64);
            int n = AesGcm.NonceByteSizes.MaxSize, t = AesGcm.TagByteSizes.MaxSize;
            var nonce = blob[..n];
            var tag = blob[n..(n + t)];
            var ct = blob[(n + t)..];
            var pt = new byte[ct.Length];
            using var aes = new AesGcm(Key(), tag.Length);
            aes.Decrypt(nonce, ct, tag, pt);
            return Encoding.UTF8.GetString(pt);
        }
        catch { return null; } // wrong key (env changed) or corrupt — caller re-prompts
    }
}
