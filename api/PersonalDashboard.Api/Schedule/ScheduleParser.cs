using System.Text.RegularExpressions;
using PersonalDashboard.Api.Domain;

namespace PersonalDashboard.Api.Schedule;

/// <summary>
/// Parses the weekly timetable markdown (a "## Day" header followed by a
/// | Time | Duration | Activity | Notes | table) into ScheduleBlock rows.
/// Lives in the repo under SeedData/ so the user's plan survives even though the
/// original zip will be deleted.
/// </summary>
public static partial class ScheduleParser
{
    public static List<ScheduleBlock> Parse(string markdown)
    {
        var blocks = new List<ScheduleBlock>();
        DayOfWeek? currentDay = null;

        foreach (var raw in markdown.Split('\n'))
        {
            var line = raw.Trim();

            // "## Monday" etc. Stops at the "Time Allocation Summary" section.
            if (line.StartsWith("## "))
            {
                var name = line[3..].Trim();
                currentDay = Enum.TryParse<DayOfWeek>(name, ignoreCase: true, out var d) ? d : null;
                continue;
            }

            if (currentDay is null || !line.StartsWith("|")) continue;

            var cells = line.Trim('|').Split('|').Select(c => c.Trim()).ToArray();
            if (cells.Length < 3) continue;
            // Skip header and separator rows.
            if (cells[0].Equals("Time", StringComparison.OrdinalIgnoreCase)) continue;
            if (cells[0].StartsWith("---") || cells[0].StartsWith(":--")) continue;

            var time = ParseTime(cells[0]);
            if (time is null) continue;

            var activity = CleanMarkdown(cells[2]);
            if (string.IsNullOrWhiteSpace(activity)) continue;
            var notes = cells.Length > 3 ? CleanMarkdown(cells[3]) : "";
            var details = cells.Length > 4 ? CleanMarkdown(cells[4]) : "";

            var category = Categorize(activity, notes);
            blocks.Add(new ScheduleBlock
            {
                Day = currentDay.Value,
                StartMinutes = time.Value,
                DurationMinutes = ParseDuration(cells[1]),
                Activity = activity,
                Notes = string.IsNullOrWhiteSpace(notes) ? null : notes,
                Details = string.IsNullOrWhiteSpace(details) ? null : details,
                Category = category,
                Protected = IsProtected(activity, notes),
            });
        }

        return blocks;
    }

    private static int? ParseTime(string s)
    {
        var m = TimeRegex().Match(s);
        if (!m.Success) return null;
        return int.Parse(m.Groups[1].Value) * 60 + int.Parse(m.Groups[2].Value);
    }

    /// <summary>"3h 45min", "90 min", "1h", "2 min", "—" → minutes (null if open-ended).</summary>
    private static int? ParseDuration(string s)
    {
        s = s.Trim();
        if (s.Length == 0 || s == "—" || s == "-") return null;
        var hours = HoursRegex().Match(s);
        var mins = MinsRegex().Match(s);
        int total = 0;
        if (hours.Success) total += int.Parse(hours.Groups[1].Value) * 60;
        if (mins.Success) total += int.Parse(mins.Groups[1].Value);
        return total > 0 ? total : null;
    }

    private static string CleanMarkdown(string s) =>
        s.Replace("**", "").Replace("*", "").Trim();

    private static ScheduleCategory Categorize(string activity, string notes)
    {
        var t = (activity + " " + notes).ToLowerInvariant();
        if (HasAny(t, "climb", "lift", "cardio", "mobility", "stretch", "pull-up", "squat", "zone 2", "walk", "jog", "hike"))
            return ScheduleCategory.Training;
        if (HasAny(t, "vocal", "guitar", "songwriting", "studio", "song", "melody", "lyric", "demo", "improv"))
            return ScheduleCategory.Music;
        if (HasAny(t, "deep work", "work block", "work wrap", "comms", "coding", "upskill"))
            return ScheduleCategory.Work;
        if (HasAny(t, "meal", "breakfast", "lunch", "dinner", "coffee", "snack", "eat", "oats", "smoothie"))
            return ScheduleCategory.Meal;
        if (HasAny(t, "sleep", "wind down", "wind-down"))
            return ScheduleCategory.Sleep;
        if (HasAny(t, "partner", "reading", "decompress", "read", "review", "plan for tomorrow"))
            return ScheduleCategory.Personal;
        if (HasAny(t, "wake", "water", "shower", "break"))
            return ScheduleCategory.Routine;
        return ScheduleCategory.Other;
    }

    private static bool IsProtected(string activity, string notes)
    {
        var t = (activity + " " + notes).ToLowerInvariant();
        return HasAny(t, "deep work", "partner time", "studio session", "studio", "weekly review");
    }

    private static bool HasAny(string text, params string[] needles) =>
        needles.Any(text.Contains);

    [GeneratedRegex(@"(\d{1,2}):(\d{2})")]
    private static partial Regex TimeRegex();
    [GeneratedRegex(@"(\d+)\s*h")]
    private static partial Regex HoursRegex();
    [GeneratedRegex(@"(\d+)\s*min")]
    private static partial Regex MinsRegex();
}
