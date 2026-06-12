using Ical.Net;
using PersonalDashboard.Api.Domain;
using IcalEvent = Ical.Net.CalendarComponents.CalendarEvent;

namespace PersonalDashboard.Api.Integrations;

/// <summary>
/// Parses a Google Calendar "secret iCal" feed into <see cref="CalendarEvent"/>
/// rows. Recurring events are expanded into concrete occurrences within the
/// requested window so the dashboard's day/week views just work.
/// </summary>
public static class GoogleCalendarSync
{
    public static List<CalendarEvent> Parse(string ics, int dataSourceId, DateTime fromUtc, DateTime toUtc, string idPrefix = "")
    {
        var cal = Calendar.Load(ics);
        var events = new List<CalendarEvent>();

        foreach (var occ in cal.GetOccurrences(fromUtc, toUtc))
        {
            if (occ.Source is not IcalEvent ev) continue;

            var start = occ.Period.StartTime;
            var allDay = !start.HasTime;
            // All-day events carry a bare date with no real time/zone — anchor them at
            // that date's midnight UTC so they don't drift a day under the server's tz.
            DateTimeOffset startsAt = allDay
                ? new DateTimeOffset(start.Value.Date, TimeSpan.Zero)
                : new DateTimeOffset(DateTime.SpecifyKind(start.AsUtc, DateTimeKind.Utc));
            DateTimeOffset endsAt = (occ.Period.EndTime, allDay) switch
            {
                (null, _) => startsAt,
                (var e, true) => new DateTimeOffset(e!.Value.Date, TimeSpan.Zero),
                (var e, false) => new DateTimeOffset(DateTime.SpecifyKind(e!.AsUtc, DateTimeKind.Utc)),
            };

            events.Add(new CalendarEvent
            {
                DataSourceId = dataSourceId,
                // Feed prefix + UID + occurrence start keeps instances distinct across calendars.
                ExternalId = $"{idPrefix}{ev.Uid}:{startsAt:O}",
                Title = string.IsNullOrWhiteSpace(ev.Summary) ? "(busy)" : ev.Summary.Trim(),
                StartsAt = startsAt,
                EndsAt = endsAt,
                AllDay = allDay,
                Location = string.IsNullOrWhiteSpace(ev.Location) ? null : ev.Location.Trim(),
            });
        }
        return events;
    }
}
