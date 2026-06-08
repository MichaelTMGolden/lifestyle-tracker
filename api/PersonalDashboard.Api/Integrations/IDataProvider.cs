using PersonalDashboard.Api.Data;
using PersonalDashboard.Api.Domain;

namespace PersonalDashboard.Api.Integrations;

/// <summary>How a provider currently gets data into the app.</summary>
public enum ProviderMode { Api, Import, Manual }

public record SyncResult(bool Ok, int Records, string Message);

/// <summary>
/// A pluggable data source. The whole point of this seam: adding the real
/// Garmin / MyFitnessPal API later means implementing one of these and flipping
/// <see cref="Configured"/> on — nothing else in the app changes.
/// </summary>
public interface IDataProvider
{
    SourceKind Kind { get; }
    string Name { get; }
    ProviderMode Mode { get; }

    /// <summary>Can this provider pull data right now (creds present / files available)?</summary>
    bool Configured { get; }

    /// <summary>Short status note shown on the Connections page.</summary>
    string Status { get; }

    /// <summary>Pull the latest data into the DB. Should be idempotent.</summary>
    Task<SyncResult> SyncAsync(AppDbContext db, int tzOffsetMinutes);
}
