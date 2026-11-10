using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace PersonalDashboard.Api.Integrations;

/// <summary>
/// Reads workouts sent from the phone. Accepts Health Auto Export's JSON
/// ({"data": {"workouts": [...]}}, v2 and the v1 field names) and the same
/// workout fields at the top level ({"workouts": [...]}) for a Shortcut.
/// Workouts it can't read are skipped and counted, never fail the batch.
/// </summary>
public static partial class HealthIngest
{
    /// <summary>The most workouts one upload may hold; a bigger one is refused whole, never cut short.</summary>
    public const int MaxWorkouts = 5000;

    /// <summary>The workouts in a batch; TooMany (and nothing else) when it holds more than <see cref="MaxWorkouts"/>.</summary>
    public static (List<IncomingWorkout> Workouts, int Skipped, bool TooMany) Parse(JsonElement root)
    {
        var list = new List<IncomingWorkout>();
        var skipped = 0;
        JsonElement arr = default;
        var found = root.ValueKind == JsonValueKind.Object
            && ((root.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Object && data.TryGetProperty("workouts", out arr))
                || root.TryGetProperty("workouts", out arr));
        if (!found || arr.ValueKind != JsonValueKind.Array) return (list, 0, false);
        if (arr.GetArrayLength() > MaxWorkouts) return (list, 0, true);
        foreach (var w in arr.EnumerateArray())
        {
            var parsed = ParseOne(w);
            if (parsed is null) skipped++; else list.Add(parsed);
        }
        return (list, skipped, false);
    }

    static IncomingWorkout? ParseOne(JsonElement w)
    {
        if (w.ValueKind != JsonValueKind.Object) return null;
        var name = Str(w, "name") ?? Str(w, "type");
        var start = Date(Str(w, "start"));
        if (name is null || start is null) return null;
        var end = Date(Str(w, "end"));
        // v2: seconds; v1 has no duration, so use end − start.
        double? seconds = Num(w, "duration") ?? (end is { } e ? (e - start.Value).TotalSeconds : null);
        if (seconds is null or < 0 or > 86_400) return null;
        var id = Str(w, "id") ?? $"{name}|{start.Value.ToUniversalTime():O}";
        return new IncomingWorkout(
            ExternalId: id.Length <= 100 ? id : id[..100],
            Type: WorkoutStore.NormalizeType(name),
            Title: name,
            StartedAt: start.Value,
            EndedAt: end,
            DurationMinutes: (int)Math.Round(seconds.Value / 60),
            DistanceMeters: Meters(w, "distance"),
            Calories: Kcal(w, "activeEnergyBurned") ?? Kcal(w, "activeEnergy"),
            AverageHeartRate: HeartRate(w),
            RecordedBy: Source(w));
    }

    /// <summary>
    /// The recording app. v2 sends {"name": "Hevy", "identifier": "com.hevy..."};
    /// a plain string is accepted too. Name and identifier are both kept, so either can match.
    /// </summary>
    static string? Source(JsonElement w)
    {
        if (Str(w, "source") is string plain) return plain;
        if (!w.TryGetProperty("source", out var src) || src.ValueKind != JsonValueKind.Object) return null;
        var parts = new[] { Str(src, "name"), Str(src, "identifier") }.OfType<string>().ToArray();
        return parts.Length == 0 ? null : string.Join(" ", parts);
    }

    static string? Str(JsonElement o, string key) =>
        o.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String && v.GetString() is { Length: > 0 } s ? s : null;

    static double? Num(JsonElement o, string key) =>
        o.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetDouble(out var d) && double.IsFinite(d) ? d : null;

    /// <summary>{"qty": n, "units": "..."} → (n, units).</summary>
    static (double Qty, string Units)? Quantity(JsonElement o, string key)
    {
        if (!o.TryGetProperty(key, out var q) || q.ValueKind != JsonValueKind.Object) return null;
        var qty = Num(q, "qty");
        return qty is null ? null : (qty.Value, (Str(q, "units") ?? "").Trim().ToLowerInvariant());
    }

    static double? Meters(JsonElement o, string key) => Quantity(o, key) switch
    {
        null => null,
        (var q, var u) when u is "km" => q * 1000,
        (var q, var u) when u is "mi" => q * 1609.344,
        (var q, var u) when u is "m" or "" => q,
        (var q, var u) when u is "yd" => q * 0.9144,
        _ => null,
    };

    static int? Kcal(JsonElement o, string key) => Quantity(o, key) switch
    {
        null => null,
        (var q, var u) when u is "kcal" or "cal" or "" => (int)Math.Round(q),
        (var q, var u) when u is "kj" => (int)Math.Round(q / 4.184),
        _ => null,
    };

    static int? HeartRate(JsonElement o)
    {
        if (Quantity(o, "avgHeartRate") is (var q, _)) return (int)Math.Round(q);
        if (o.TryGetProperty("heartRate", out var hr) && hr.ValueKind == JsonValueKind.Object && Quantity(hr, "avg") is (var a, _)) return (int)Math.Round(a);
        return null;
    }

    // Health Auto Export: "2024-02-06 07:00:00 -0800". ISO 8601 is accepted too.
    [GeneratedRegex(@"^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-])(\d{2})(\d{2})$")]
    private static partial Regex HaeDate();

    public static DateTimeOffset? Date(string? s)
    {
        if (s is null) return null;
        var m = HaeDate().Match(s.Trim());
        if (m.Success) s = $"{m.Groups[1].Value}T{m.Groups[2].Value}{m.Groups[3].Value}{m.Groups[4].Value}:{m.Groups[5].Value}";
        return DateTimeOffset.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : null;
    }
}
