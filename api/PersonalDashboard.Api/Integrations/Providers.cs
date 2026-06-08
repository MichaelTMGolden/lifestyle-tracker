using PersonalDashboard.Api.Data;
using PersonalDashboard.Api.Domain;
using PersonalDashboard.Api.Garmin;

namespace PersonalDashboard.Api.Integrations;

/// <summary>
/// Garmin via file import — ingests Garmin Connect exports through
/// <see cref="GarminCsvImporter"/>. This is the real, working source today.
/// The import directory is configurable; uploaded files also land here.
/// </summary>
public sealed class GarminImportProvider : IDataProvider
{
    private readonly string _dir;
    public GarminImportProvider(IConfiguration cfg)
    {
        _dir = cfg["Integrations:GarminImportPath"]
            ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
    }

    public string ImportDir => _dir;
    public SourceKind Kind => SourceKind.Garmin;
    public string Name => "Garmin";
    public ProviderMode Mode => ProviderMode.Import;
    public bool Configured =>
        File.Exists(Path.Combine(_dir, "garmin-health-daily.csv")) ||
        File.Exists(Path.Combine(_dir, "garmin_api_sleep_daily.csv"));
    public string Status => Configured
        ? "Connected via file import"
        : "Drop a Garmin Connect export to import — official API is a later drop-in";

    public async Task<SyncResult> SyncAsync(AppDbContext db, int tzOffsetMinutes)
    {
        if (!Configured) return new SyncResult(false, 0, "No Garmin export files found to import.");
        var r = await new GarminCsvImporter(db).ImportAsync(_dir);
        return new SyncResult(true, r.SamplesWritten,
            $"{r.HealthDays} health days · {r.SleepDays} sleep days · {r.SamplesWritten} samples. {r.Notes}");
    }
}

/// <summary>
/// A source whose live integration isn't wired yet (awaiting API credentials /
/// approval, or — for MyFitnessPal — no public API at all). It occupies the
/// Connections list as a labelled, ready seam rather than faking data.
/// </summary>
public sealed class PendingProvider : IDataProvider
{
    public PendingProvider(SourceKind kind, string name, ProviderMode mode, string status, bool configured = false)
    { Kind = kind; Name = name; Mode = mode; Status = status; Configured = configured; }

    public SourceKind Kind { get; }
    public string Name { get; }
    public ProviderMode Mode { get; }
    public bool Configured { get; }
    public string Status { get; }

    public Task<SyncResult> SyncAsync(AppDbContext db, int tzOffsetMinutes) =>
        Task.FromResult(new SyncResult(false, 0, $"{Name} isn't connected yet — {Status}"));
}
