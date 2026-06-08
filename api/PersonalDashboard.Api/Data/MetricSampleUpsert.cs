using Microsoft.EntityFrameworkCore;
using PersonalDashboard.Api.Domain;

namespace PersonalDashboard.Api.Data;

/// <summary>
/// Idempotent insert for incremental syncs (e.g. Spotify "recently played"
/// polling, a live Garmin pull). Keyed on the unique index
/// (DataSourceId, MetricKey, RecordedAt) — re-pulling overlapping windows
/// updates the existing row instead of double-counting.
///
/// The Garmin CSV importer keeps its delete-all-then-insert approach (no
/// conflicts there); route any *incremental* writes through this.
/// </summary>
public static class MetricSampleUpsert
{
    public static async Task UpsertAsync(AppDbContext db, IEnumerable<MetricSample> samples)
    {
        foreach (var s in samples)
        {
            await db.Database.ExecuteSqlInterpolatedAsync($@"
                INSERT INTO ""MetricSamples"" (""DataSourceId"", ""MetricKey"", ""RecordedAt"", ""Value"", ""Unit"")
                VALUES ({s.DataSourceId}, {s.MetricKey}, {s.RecordedAt}, {s.Value}, {s.Unit})
                ON CONFLICT (""DataSourceId"", ""MetricKey"", ""RecordedAt"")
                DO UPDATE SET ""Value"" = EXCLUDED.""Value"", ""Unit"" = EXCLUDED.""Unit""");
        }
    }
}
