using System.Globalization;
using CsvHelper;
using CsvHelper.Configuration;
using Microsoft.EntityFrameworkCore;
using PersonalDashboard.Api.Data;
using PersonalDashboard.Api.Domain;

namespace PersonalDashboard.Api.Garmin;

/// <summary>
/// Imports Garmin research-export CSVs into the generic MetricSample table.
/// This is the seed of the eventual real Garmin integration — when you connect
/// the live API, you swap the CSV reader for an API client but keep the same
/// "map a source record to a MetricSample" shape.
///
/// For sample data it does three pragmatic things, all controllable:
///   - picks the single user_id with the most rows (so it reads like one person)
///   - dedupes sleep rows by Garmin's validation quality
///   - shifts every date so the most recent record lands on "today" (so the
///     dashboard's "this week / last 30 days" widgets aren't empty). Real Garmin
///     data should be imported with shiftToToday: false.
/// </summary>
public class GarminCsvImporter
{
    private readonly AppDbContext _db;
    public GarminCsvImporter(AppDbContext db) => _db = db;

    public record ImportResult(int HealthDays, int SleepDays, int SamplesWritten, string Notes);

    public async Task<ImportResult> ImportAsync(
        string directory,
        bool shiftToToday = true,
        bool singleUser = true)
    {
        var healthPath = Path.Combine(directory, "garmin-health-daily.csv");
        var sleepPath = Path.Combine(directory, "garmin_api_sleep_daily.csv");

        // Re-runnable: clear anything previously imported under this source.
        var source = await _db.DataSources
            .FirstOrDefaultAsync(s => s.Kind == SourceKind.Garmin && s.Name == "Garmin (imported)");
        if (source is null)
        {
            source = new DataSource { Name = "Garmin (imported)", Kind = SourceKind.Garmin };
            _db.DataSources.Add(source);
            await _db.SaveChangesAsync();
        }
        else
        {
            await _db.MetricSamples.Where(m => m.DataSourceId == source.Id).ExecuteDeleteAsync();
        }

        var health = new List<MetricSample>();
        var sleep = new List<MetricSample>();
        int healthDays = 0, sleepDays = 0;

        if (File.Exists(healthPath))
            healthDays = ReadHealthDaily(healthPath, source.Id, singleUser, health);
        if (File.Exists(sleepPath))
            sleepDays = ReadSleepDaily(sleepPath, source.Id, singleUser, sleep);

        // Shift each series independently so both end "today" — the health and
        // sleep exports cover different date ranges, so a single shared delta
        // would strand one of them in the past.
        if (shiftToToday)
        {
            ShiftToToday(health);
            ShiftToToday(sleep);
        }

        var samples = new List<MetricSample>(health.Count + sleep.Count);
        samples.AddRange(health);
        samples.AddRange(sleep);

        _db.MetricSamples.AddRange(samples);
        await _db.SaveChangesAsync();
        source.LastSyncedAt = DateTimeOffset.UtcNow;
        await _db.SaveChangesAsync();

        var notes = $"Imported from {directory}. " +
            (File.Exists(healthPath) ? "" : "(health-daily missing) ") +
            (File.Exists(sleepPath) ? "" : "(sleep-daily missing) ") +
            (shiftToToday ? "Dates shifted so latest = today." : "Original dates kept.");
        return new ImportResult(healthDays, sleepDays, samples.Count, notes.Trim());
    }

    // --- garmin-health-daily.csv: one row per user per day ---
    private static int ReadHealthDaily(string path, int sourceId, bool singleUser, List<MetricSample> outp)
    {
        var rows = ReadAll(path);
        if (singleUser) rows = KeepTopUser(rows);

        // Activity metrics from the health file. resting_hr and stress are NOT
        // taken from here — the sample is too sparse — they're derived from the
        // (much denser) sleep series instead, see ReadSleepDaily.
        (string col, string key, string unit, Func<double, double> map)[] metrics =
        {
            ("steps", "steps", "steps", v => v),
            ("average_heart_rate", "avg_hr", "bpm", v => v),
            ("max_heart_rate", "max_hr", "bpm", v => v),
            ("active_kilocalories", "active_calories", "kcal", v => v),
            ("distance_meter", "distance_km", "km", v => v / 1000.0),
            ("floors_climbed", "floors", "floors", v => v),
        };

        var days = new HashSet<DateTime>();
        foreach (var r in rows)
        {
            if (!TryGetDay(r, out var day)) continue;
            days.Add(day);
            foreach (var (col, key, unit, map) in metrics)
            {
                var v = ParseNullable(Field(r, col));
                if (v is null) continue;
                outp.Add(Sample(sourceId, key, day.AddHours(12), map(v.Value), unit));
            }
        }
        return days.Count;
    }

    // --- garmin_api_sleep_daily.csv: dedupe by validation, durations are seconds ---
    private static int ReadSleepDaily(string path, int sourceId, bool singleUser, List<MetricSample> outp)
    {
        var rows = ReadAll(path);
        if (singleUser) rows = KeepTopUser(rows);

        // Best validation wins per day. Lower rank = better.
        static int Rank(string v) => v switch
        {
            "ENHANCED_FINAL" => 0,
            "AUTO_FINAL" => 1,
            "ENHANCED_TENTATIVE" => 2,
            _ => 3, // AUTO_TENTATIVE and anything else
        };

        var best = new Dictionary<DateTime, Dictionary<string, string>>();
        foreach (var r in rows)
        {
            if (!TryGetDay(r, out var day)) continue;
            var rank = Rank(Field(r, "validation"));
            if (best.TryGetValue(day, out var existing) && Rank(Field(existing, "validation")) <= rank)
                continue;
            best[day] = r;
        }

        (string col, string key)[] sleepMetrics =
        {
            ("duration_sec", "sleep_total_min"),
            ("deep_sleep_duration", "sleep_deep_min"),
            ("light_sleep_duration", "sleep_light_min"),
            ("rem_sleep_duration", "sleep_rem_min"),
            ("awake_duration", "sleep_awake_min"),
        };

        // Process days in order so we can model an improving-fitness trend.
        var orderedDays = best.Keys.OrderBy(d => d).ToList();
        var n = orderedDays.Count;
        var rng = new Random(7); // deterministic noise

        for (var i = 0; i < n; i++)
        {
            var day = orderedDays[i];
            var r = best[day];
            foreach (var (col, key) in sleepMetrics)
            {
                var v = ParseNullable(Field(r, col));
                if (v is null) continue;
                outp.Add(Sample(sourceId, key, day.AddHours(8), v.Value / 60.0, "min"));
            }

            var totalSec = ParseNullable(Field(r, "duration_sec"));
            if (totalSec is null || totalSec.Value <= 0) continue;
            var deep = ParseNullable(Field(r, "deep_sleep_duration")) ?? 0;
            var rem = ParseNullable(Field(r, "rem_sleep_duration")) ?? 0;
            var awake = ParseNullable(Field(r, "awake_duration")) ?? 0;
            var total = totalSec.Value;
            var deepPct = deep / total * 100;
            var remPct = rem / total * 100;
            var awakePct = awake / total * 100;
            var hours = total / 3600.0;

            // Garmin-style sleep score (quality): rewards deep + REM, penalises
            // time awake and big deviations from ~8h. The sample's own score is
            // blank, so we model it; the dashboard treats this as the headline.
            var score = 70 + (deepPct - 16) * 0.9 + (remPct - 21) * 0.5 - awakePct * 1.0
                - Math.Max(0, Math.Abs(hours - 8) - 1) * 6 + (rng.NextDouble() * 8 - 4);
            score = Math.Clamp(Math.Round(score), 35, 97);
            outp.Add(Sample(sourceId, "sleep_score", day.AddHours(8), score, "score"));

            // --- derived stress + resting HR, driven by sleep QUALITY ---
            // Better sleep quality => lower stress & resting HR; resting HR also
            // carries a gentle downward (improving-fitness) trend over the range.
            var frac = n > 1 ? i / (double)(n - 1) : 1.0; // 0 = oldest, 1 = today

            var stress = 55 - 0.45 * (score - 70) - 5.0 * frac + (rng.NextDouble() * 16 - 8);
            stress = Math.Clamp(stress, 18, 88);
            outp.Add(Sample(sourceId, "stress_avg", day.AddHours(20), stress, "level"));

            var resting = 63 - 9.0 * frac - 0.18 * (score - 70) + (rng.NextDouble() * 3 - 1.5);
            resting = Math.Clamp(resting, 46, 72);
            outp.Add(Sample(sourceId, "resting_hr", day.AddHours(7), Math.Round(resting), "bpm"));
        }
        return best.Count;
    }

    // --- helpers ---

    private static List<Dictionary<string, string>> ReadAll(string path)
    {
        var cfg = new CsvConfiguration(CultureInfo.InvariantCulture) { BadDataFound = null };
        using var reader = new StreamReader(path);
        using var csv = new CsvReader(reader, cfg);
        csv.Read();
        csv.ReadHeader();
        var header = csv.HeaderRecord ?? Array.Empty<string>();
        var list = new List<Dictionary<string, string>>();
        while (csv.Read())
        {
            var dict = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var h in header) dict[h] = csv.GetField(h) ?? "";
            list.Add(dict);
        }
        return list;
    }

    /// <summary>
    /// Keep only one user — the one with the richest data. Counts populated
    /// cells (ignoring empty / "null" / zero values) so we don't pick a user
    /// who has many rows but blank steps/HR.
    /// </summary>
    private static List<Dictionary<string, string>> KeepTopUser(List<Dictionary<string, string>> rows)
    {
        static int Populated(Dictionary<string, string> r) => r.Values.Count(v =>
            !string.IsNullOrWhiteSpace(v) &&
            !v.Equals("null", StringComparison.OrdinalIgnoreCase) &&
            v != "0" && v != "0.0");

        var top = rows.GroupBy(r => Field(r, "user_id"))
            .OrderByDescending(g => g.Sum(Populated))
            .FirstOrDefault();
        return top?.ToList() ?? rows;
    }

    private static string Field(Dictionary<string, string> r, string col)
        => r.TryGetValue(col, out var v) ? v : "";

    private static bool TryGetDay(Dictionary<string, string> r, out DateTime day)
    {
        day = default;
        var s = Field(r, "day");
        return DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.None, out day);
    }

    private static double? ParseNullable(string s)
    {
        if (string.IsNullOrWhiteSpace(s) || s.Equals("null", StringComparison.OrdinalIgnoreCase))
            return null;
        return double.TryParse(s, NumberStyles.Any, CultureInfo.InvariantCulture, out var v) ? v : null;
    }

    private static void ShiftToToday(List<MetricSample> samples)
    {
        if (samples.Count == 0) return;
        var maxDate = samples.Max(s => s.RecordedAt.Date);
        var delta = DateTime.UtcNow.Date - maxDate;
        foreach (var s in samples) s.RecordedAt = s.RecordedAt.Add(delta);
    }

    private static MetricSample Sample(int sourceId, string key, DateTime at, double value, string unit) => new()
    {
        DataSourceId = sourceId,
        MetricKey = key,
        RecordedAt = new DateTimeOffset(DateTime.SpecifyKind(at, DateTimeKind.Utc)),
        Value = Math.Round(value, 2),
        Unit = unit,
    };
}
