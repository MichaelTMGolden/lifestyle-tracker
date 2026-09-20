using PersonalDashboard.Api.Domain;
using PersonalDashboard.Api.Schedule;
using Xunit;

namespace PersonalDashboard.Api.Tests;

public class DayAgendaTests
{
    private static readonly DateTimeOffset Day = new(2026, 9, 19, 0, 0, 0, TimeSpan.FromHours(1));

    [Fact]
    public void Appointment_interrupts_routine_and_remaining_time_can_resume()
    {
        var blocks = new[] { new ScheduleBlock { Activity = "Practice", StartMinutes = 600, DurationMinutes = 120 } };
        var events = new[] { new CalendarEvent { Title = "Appointment", StartsAt = Day.AddMinutes(630), EndsAt = Day.AddMinutes(660) } };
        var agenda = DayAgenda.Build(blocks, events, Day);
        Assert.Equal("Appointment", DayAgenda.Current(agenda, 640)!.Activity);
        Assert.Equal("Practice", DayAgenda.Current(agenda, 660)!.Activity);
        Assert.Equal(60, DayAgenda.Current(agenda, 660)!.DurationMinutes);
        Assert.Equal(3, agenda.Count);
    }

    [Fact]
    public void All_day_reminders_do_not_cancel_the_routine_and_overnight_events_are_clipped()
    {
        var events = new[] {
            new CalendarEvent { Title = "Birthday", StartsAt = Day, EndsAt = Day.AddDays(1), AllDay = true },
            new CalendarEvent { Title = "Late event", StartsAt = Day.AddHours(-1), EndsAt = Day.AddHours(1) },
            new CalendarEvent { Title = "Tomorrow", StartsAt = Day.AddDays(1), EndsAt = Day.AddDays(1).AddHours(1) },
        };
        var agenda = DayAgenda.Build(Array.Empty<ScheduleBlock>(), events, Day);
        var item = Assert.Single(agenda);
        Assert.Equal(0, item.StartMinutes);
        Assert.Equal(60, item.DurationMinutes);
        Assert.Null(DayAgenda.Current(agenda, 60));
    }

    [Fact]
    public void Missing_duration_runs_until_next_block_and_final_block_until_midnight()
    {
        // Deliberately unsorted: endpoint callers should not determine duration.
        var blocks = new[] {
            new ScheduleBlock { Activity = "Evening", StartMinutes = 1080 },
            new ScheduleBlock { Activity = "Practice", StartMinutes = 600 },
            new ScheduleBlock { Activity = "Lunch", StartMinutes = 720, DurationMinutes = 45 },
        };
        var agenda = DayAgenda.Build(blocks, Array.Empty<CalendarEvent>(), Day);
        Assert.Equal("Practice", DayAgenda.Current(agenda, 719)!.Activity);
        Assert.Equal(120, DayAgenda.Current(agenda, 719)!.DurationMinutes);
        Assert.Equal("Lunch", DayAgenda.Current(agenda, 720)!.Activity);
        Assert.Null(DayAgenda.Current(agenda, 765));
        Assert.Equal("Evening", DayAgenda.Current(agenda, 1439)!.Activity);
        Assert.Null(DayAgenda.Current(agenda, 1440));
    }

    [Fact]
    public void Calendar_still_interrupts_and_resumes_a_block_with_inferred_duration()
    {
        var blocks = new[] {
            new ScheduleBlock { Activity = "Practice", StartMinutes = 600 },
            new ScheduleBlock { Activity = "Lunch", StartMinutes = 720, DurationMinutes = 45 },
        };
        var events = new[] { new CalendarEvent { Title = "Appointment", StartsAt = Day.AddMinutes(630), EndsAt = Day.AddMinutes(660) } };
        var agenda = DayAgenda.Build(blocks, events, Day);
        Assert.Equal("Appointment", DayAgenda.Current(agenda, 659)!.Activity);
        Assert.Equal("Practice", DayAgenda.Current(agenda, 660)!.Activity);
        Assert.Equal(60, DayAgenda.Current(agenda, 660)!.DurationMinutes);
        Assert.Equal("Lunch", DayAgenda.Current(agenda, 720)!.Activity);
    }
}
