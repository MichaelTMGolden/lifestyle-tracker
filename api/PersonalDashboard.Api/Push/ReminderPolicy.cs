namespace PersonalDashboard.Api.Push;

/// <summary>When a habit reminder should go out. Pure, so it can be tested.</summary>
public static class ReminderPolicy
{
    /// <summary>
    /// Due once the local time passes the reminder time, on a day the habit
    /// isn't done yet and the reminder hasn't already been sent.
    /// </summary>
    public static bool IsDue(int? reminderMinutes, DateOnly? lastSentOn, bool doneToday, DateTime localNow)
    {
        if (reminderMinutes is not int at || at < 0 || at >= 24 * 60) return false;
        var today = DateOnly.FromDateTime(localNow);
        if (doneToday || lastSentOn == today) return false;
        return localNow.Hour * 60 + localNow.Minute >= at;
    }

    /// <summary>"7:30 PM"-style label for a reminder time, from minutes after midnight.</summary>
    public static string Label(int minutes) => DateTime.Today.AddMinutes(minutes).ToString("H:mm");
}
