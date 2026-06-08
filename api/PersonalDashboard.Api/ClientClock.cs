namespace PersonalDashboard.Api;

/// <summary>
/// "Now" / "today" resolved in the client's local timezone, so the dashboard is
/// correct while travelling. The frontend sends its current UTC offset via the
/// <c>X-Tz-Offset</c> header (JavaScript <c>Date.getTimezoneOffset()</c>, i.e.
/// minutes of UTC minus local). We use the device's *current* offset, which is
/// exactly what you want for today/now (it tracks travel and DST automatically).
/// </summary>
public readonly record struct ClientClock(int OffsetMinutes)
{
    /// <summary>UTC instant treated as "now" — overridable in tests; defaults to wall clock.</summary>
    public DateTime UtcNow { get; init; } = DateTime.UtcNow;

    public static ClientClock From(HttpRequest req)
    {
        var raw = req.Headers["X-Tz-Offset"].FirstOrDefault();
        return new ClientClock(int.TryParse(raw, out var m) ? m : 0);
    }

    /// <summary>Wall-clock "now" in the client's timezone.</summary>
    public DateTime LocalNow => UtcNow.AddMinutes(-OffsetMinutes);
    public DateOnly Today => DateOnly.FromDateTime(LocalNow);
    public DayOfWeek DayOfWeek => LocalNow.DayOfWeek;
    public int NowMinutes => LocalNow.Hour * 60 + LocalNow.Minute;

    /// <summary>UTC instant of the client's local midnight today.</summary>
    public DateTimeOffset TodayStartUtc =>
        new DateTimeOffset(Today.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero).AddMinutes(OffsetMinutes);
    public DateTimeOffset TodayEndUtc => TodayStartUtc.AddDays(1);
}
