using PersonalDashboard.Api.Domain;

namespace PersonalDashboard.Api.Schedule;

public record AgendaItem(string Activity, int StartMinutes, int DurationMinutes, string Category, string Source);

/// <summary>Calendar appointments take precedence; remaining portions of a routine can resume afterwards.</summary>
public static class DayAgenda
{
    public static List<AgendaItem> Build(IEnumerable<ScheduleBlock> blocks, IEnumerable<CalendarEvent> events,
        DateTimeOffset dayStart)
    {
        var appointments = events.Where(e => !e.AllDay && e.EndsAt > dayStart && e.StartsAt < dayStart.AddDays(1))
            .Select(e => new AgendaItem(e.Title,
                Math.Max(0, (int)(e.StartsAt - dayStart).TotalMinutes),
                Math.Min(1440, (int)(e.EndsAt - dayStart).TotalMinutes) - Math.Max(0, (int)(e.StartsAt - dayStart).TotalMinutes),
                "Calendar", "calendar"))
            .Where(e => e.DurationMinutes > 0).ToList();
        var result = new List<AgendaItem>(appointments);
        var routines = blocks.OrderBy(b => b.StartMinutes).ToList();
        foreach (var block in routines)
        {
            // An omitted duration means "until the next routine", with the
            // final routine continuing to midnight, matching Today's timeline.
            var blockEnd = block.DurationMinutes is { } duration
                ? block.StartMinutes + duration
                : routines.FirstOrDefault(b => b.StartMinutes > block.StartMinutes)?.StartMinutes ?? 1440;
            var pieces = new List<(int Start, int End)> { (Math.Max(0, block.StartMinutes), Math.Min(1440, blockEnd)) };
            foreach (var appointment in appointments)
            {
                var next = new List<(int Start, int End)>();
                var end = appointment.StartMinutes + appointment.DurationMinutes;
                foreach (var piece in pieces)
                {
                    if (appointment.StartMinutes >= piece.End || end <= piece.Start) next.Add(piece);
                    else
                    {
                        if (piece.Start < appointment.StartMinutes) next.Add((piece.Start, appointment.StartMinutes));
                        if (piece.End > end) next.Add((end, piece.End));
                    }
                }
                pieces = next;
            }
            result.AddRange(pieces.Where(p => p.End > p.Start).Select(p =>
                new AgendaItem(block.Activity, p.Start, p.End - p.Start, block.Category.ToString(), "routine")));
        }
        return result.OrderBy(x => x.StartMinutes).ThenBy(x => x.Source == "calendar" ? 0 : 1).ToList();
    }

    public static AgendaItem? Current(IReadOnlyList<AgendaItem> agenda, int minute) => agenda
        .Where(x => x.StartMinutes <= minute && x.StartMinutes + x.DurationMinutes > minute)
        .OrderBy(x => x.Source == "calendar" ? 0 : 1).ThenByDescending(x => x.StartMinutes).FirstOrDefault();
}
