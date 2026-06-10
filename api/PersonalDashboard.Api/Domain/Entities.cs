namespace PersonalDashboard.Api.Domain;

/// <summary>
/// Where a piece of data came from. Dummy/manual data and real integration
/// syncs (Spotify, Garmin, etc.) all flow into the same tables — the source
/// is just a tag. This is what lets you start with fake data and swap in real
/// integrations later without touching the rest of the app.
/// </summary>
public enum SourceKind
{
    Manual = 0,
    Spotify = 1,
    Garmin = 2,
    GoogleCalendar = 3,
    MyFitnessPal = 4, // legacy — no usable hobbyist API; food DB now rented from the below
    OpenFoodFacts = 5,
    Usda = 6,
}

public class DataSource
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public SourceKind Kind { get; set; }
    public DateTimeOffset? LastSyncedAt { get; set; }
}

/// <summary>
/// A generic numeric time-series sample (weight, resting HR, steps, calories
/// consumed, sleep minutes, ...). Keeping these in one table means new metric
/// types don't require schema changes.
/// </summary>
public class MetricSample
{
    public long Id { get; set; }
    public int DataSourceId { get; set; }
    public DataSource? DataSource { get; set; }

    /// <summary>Stable key e.g. "weight_kg", "resting_hr", "steps", "calories_in", "sleep_minutes".</summary>
    public required string MetricKey { get; set; }
    public DateTimeOffset RecordedAt { get; set; }
    public double Value { get; set; }
    public string? Unit { get; set; }
}

public class Workout
{
    public long Id { get; set; }
    public int DataSourceId { get; set; }
    public DataSource? DataSource { get; set; }

    public required string Type { get; set; } // "Run", "Strength", "Cycling", ...
    public DateTimeOffset StartedAt { get; set; }
    public int DurationMinutes { get; set; }
    public double? DistanceMeters { get; set; }
    public int? Calories { get; set; }
    public int? AverageHeartRate { get; set; }
}

public class CalendarEvent
{
    public long Id { get; set; }
    public int DataSourceId { get; set; }
    public DataSource? DataSource { get; set; }

    public string? ExternalId { get; set; } // id from Google Calendar, for dedupe on sync
    public required string Title { get; set; }
    public DateTimeOffset StartsAt { get; set; }
    public DateTimeOffset EndsAt { get; set; }
    public bool AllDay { get; set; }
    public string? Location { get; set; }
}

public class MusicPlay
{
    public long Id { get; set; }
    public int DataSourceId { get; set; }
    public DataSource? DataSource { get; set; }

    public string? ExternalId { get; set; }
    public required string TrackName { get; set; }
    public required string Artist { get; set; }
    public string? Album { get; set; }
    public DateTimeOffset PlayedAt { get; set; }
    public int DurationMs { get; set; }
}

public class Habit
{
    public int Id { get; set; }
    public required string Name { get; set; }
    /// <summary>How often it's expected, e.g. "daily", "weekly".</summary>
    public string Cadence { get; set; } = "daily";
    public int TargetPerPeriod { get; set; } = 1;
    public bool Archived { get; set; }

    /// <summary>
    /// When true this skill accumulates practice minutes per day (logging time
    /// also marks the day done). When false it's a plain binary done/not-done.
    /// </summary>
    public bool TracksTime { get; set; }

    public List<HabitLog> Logs { get; set; } = new();
}

public class HabitLog
{
    public long Id { get; set; }
    public int HabitId { get; set; }
    public Habit? Habit { get; set; }
    public DateOnly Date { get; set; }
    public bool Completed { get; set; }

    /// <summary>Accumulated practice minutes for this habit on this day (0 for binary skills).</summary>
    public int Minutes { get; set; }
}

/// <summary>
/// An hour target fed by one or more skills (<see cref="Habit"/>). Single-skill
/// and composite goals share this one structure — a goal is just a target plus a
/// list of feeding skills. Progress = total minutes across all feeders ÷ target.
/// New rollups are new rows, not new code.
/// </summary>
public class Goal
{
    public int Id { get; set; }
    public required string Name { get; set; }
    /// <summary>Target stored in minutes; displayed as hours.</summary>
    public int TargetMinutes { get; set; }
    public string? ColorHex { get; set; }
    /// <summary>Only count feeder minutes on/after this date; null = count all-time.</summary>
    public DateOnly? StartDate { get; set; }
    /// <summary>Optional deadline. When set, the goal shows ahead/behind pace vs a linear plan.</summary>
    public DateOnly? TargetDate { get; set; }
    /// <summary>Stamped the first time accumulated minutes reach the target. Drives the "complete" state.</summary>
    public DateOnly? CompletedOn { get; set; }
    /// <summary>Retired: hidden from the active grid, kept in the Completed section.</summary>
    public bool Archived { get; set; }

    public List<GoalSource> Sources { get; set; } = new();
}

/// <summary>Join row: which skill feeds which goal (many-to-many).</summary>
public class GoalSource
{
    public int Id { get; set; }
    public int GoalId { get; set; }
    public Goal? Goal { get; set; }
    public int HabitId { get; set; }
    public Habit? Habit { get; set; }
}

/// <summary>
/// An anomaly / pattern alert surfaced to the user. Kind/Severity/SubjectType/Status
/// are free strings (extensible — a new detector adds new Kinds without a migration).
/// DedupeKey makes regeneration idempotent (unique index → upsert, not duplicate).
/// </summary>
public class Alert
{
    public long Id { get; set; }
    public required string Kind { get; set; }        // MetricSpike, MetricDrop, SleepDebt, StreakBreak, Inactivity, GoalOffPace, DeclineTrend
    public required string Severity { get; set; }     // Info | Watch | Urgent
    public required string SubjectType { get; set; }  // Metric | Goal | Habit
    public required string SubjectKey { get; set; }   // metric key / goal id / habit id
    public required string Title { get; set; }
    public required string Detail { get; set; }
    public double? Value { get; set; }
    public double? ExpectedLow { get; set; }
    public double? ExpectedHigh { get; set; }
    public DateOnly ForDate { get; set; }
    public DateTimeOffset DetectedAt { get; set; }
    public required string DedupeKey { get; set; }    // e.g. "MetricSpike:resting_hr:2026-06-08"
    public string Status { get; set; } = "New";       // New | Seen | Dismissed
    public DateTimeOffset? DismissedAt { get; set; }
}

public enum MealType { Breakfast = 0, Lunch = 1, Dinner = 2, Snack = 3, Other = 4 }

/// <summary>Macro snapshot shared by FoodEntry, SavedFood and QuickMealItem (lets one helper build a FoodEntry from any of them).</summary>
public interface IFoodMacros
{
    string Name { get; }
    string? Brand { get; }
    string? ExternalRef { get; }
    string? ServingDescription { get; }
    double Calories { get; }
    double ProteinG { get; }
    double CarbsG { get; }
    double FatG { get; }
    double FiberG { get; }
    double SugarG { get; }
    double SatFatG { get; }
    double SodiumMg { get; }
    double PotassiumMg { get; }
    double CalciumMg { get; }
    double IronMg { get; }
}

/// <summary>
/// A remembered food: powers recents (LastUsedAt), frequents (UseCount) and
/// favorites (Favorite star). Auto-upserted whenever a FoodEntry is logged, keyed
/// on (Name, Brand, ExternalRef) so repeats increment rather than duplicate. The
/// macro snapshot is for DefaultQuantity servings; logging scales from it.
/// </summary>
public class SavedFood : IFoodMacros
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public string? Brand { get; set; }
    public int? DataSourceId { get; set; }
    public string? ExternalRef { get; set; }

    public string? ServingDescription { get; set; }
    public double DefaultQuantity { get; set; } = 1;
    public double? Grams { get; set; }

    public double Calories { get; set; }
    public double ProteinG { get; set; }
    public double CarbsG { get; set; }
    public double FatG { get; set; }
    public double FiberG { get; set; }
    public double SugarG { get; set; }
    public double SatFatG { get; set; }
    public double SodiumMg { get; set; }
    public double PotassiumMg { get; set; }
    public double CalciumMg { get; set; }
    public double IronMg { get; set; }

    public bool Favorite { get; set; }
    public int UseCount { get; set; }
    public DateTimeOffset? LastUsedAt { get; set; }
}

/// <summary>A reusable meal = a named bundle of food snapshots that expand into FoodEntry rows when logged.</summary>
public class QuickMeal
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public MealType? DefaultMeal { get; set; }
    public int UseCount { get; set; }
    public DateTimeOffset? LastUsedAt { get; set; }
    public List<QuickMealItem> Items { get; set; } = new();
}

/// <summary>A frozen food snapshot inside a QuickMeal (not an FK to SavedFood, so editing a food later doesn't shift saved meals).</summary>
public class QuickMealItem : IFoodMacros
{
    public int Id { get; set; }
    public int QuickMealId { get; set; }
    public QuickMeal? QuickMeal { get; set; }

    public required string Name { get; set; }
    public string? Brand { get; set; }
    public int? DataSourceId { get; set; }
    public string? ExternalRef { get; set; }
    public string? ServingDescription { get; set; }
    public double Quantity { get; set; } = 1;
    public double? Grams { get; set; }

    public double Calories { get; set; }
    public double ProteinG { get; set; }
    public double CarbsG { get; set; }
    public double FatG { get; set; }
    public double FiberG { get; set; }
    public double SugarG { get; set; }
    public double SatFatG { get; set; }
    public double SodiumMg { get; set; }
    public double PotassiumMg { get; set; }
    public double CalciumMg { get; set; }
    public double IronMg { get; set; }
}

/// <summary>
/// One logged food item on a given day. The day's rows are the source of truth;
/// their daily macro totals are materialized into <see cref="MetricSample"/> rows
/// (calories_in / protein_g / carbs_g / fat_g) so existing charts read them
/// generically. Macros are stored "as eaten" (already × quantity/serving) so the
/// daily sum is a plain aggregate. The food database is just another DataSource
/// (Manual / OpenFoodFacts / Usda), exactly like Garmin or Spotify.
/// </summary>
public class FoodEntry : IFoodMacros
{
    public long Id { get; set; }
    public int DataSourceId { get; set; }
    public DataSource? DataSource { get; set; }

    public DateOnly Date { get; set; }
    public DateTimeOffset LoggedAt { get; set; }

    public required string Name { get; set; }
    public string? Brand { get; set; }
    /// <summary>Open Food Facts barcode or USDA fdcId — for future barcode lookup / dedupe.</summary>
    public string? ExternalRef { get; set; }

    public string? ServingDescription { get; set; } // "1 cup", "100 g"
    public double Quantity { get; set; } = 1;
    public double? Grams { get; set; }

    public MealType Meal { get; set; } = MealType.Other;

    // As-eaten macros (already multiplied by quantity/serving).
    public double Calories { get; set; }
    public double ProteinG { get; set; }
    public double CarbsG { get; set; }
    public double FatG { get; set; }

    // As-eaten detailed nutrients (0 when unknown). g for fibre/sugar/sat-fat; mg for minerals.
    public double FiberG { get; set; }
    public double SugarG { get; set; }
    public double SatFatG { get; set; }
    public double SodiumMg { get; set; }
    public double PotassiumMg { get; set; }
    public double CalciumMg { get; set; }
    public double IronMg { get; set; }
}

/// <summary>
/// A lightweight to-do for a single day. Unlike <see cref="TodoItem"/> (long-term
/// "tasks"), these are filled fresh each day and not kept long-term — older ones
/// are purged. This is what the dashboard previews.
/// </summary>
public class DailyTodo
{
    public long Id { get; set; }
    public DateOnly Date { get; set; }
    public required string Title { get; set; }
    public bool Done { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public enum ScheduleCategory { Routine, Work, Training, Music, Meal, Personal, Sleep, Other }

/// <summary>
/// A recurring weekly time block from the user's planned timetable (read-only
/// template). Real CalendarEvents take precedence over these when they overlap —
/// that precedence is computed at query time, not stored here.
/// </summary>
public class ScheduleBlock
{
    public int Id { get; set; }
    public DayOfWeek Day { get; set; }
    public int StartMinutes { get; set; }      // minutes from midnight
    public int? DurationMinutes { get; set; }  // null = open-ended (e.g. Sleep)
    public required string Activity { get; set; }
    public string? Notes { get; set; }
    public ScheduleCategory Category { get; set; }
    public bool Protected { get; set; }        // anchors: deep work, partner time
}

public class TodoItem
{
    public long Id { get; set; }
    public required string Title { get; set; }
    public string? Notes { get; set; }
    public int Priority { get; set; } = 2; // 1 = high, 2 = medium, 3 = low
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? DueAt { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
}

/// <summary>
/// A yearly "milestone bingo" board — achieve-once goals (vs the hour-goals which
/// track accumulation). One board per year; past years remain as a record.
/// Squares are manual free text the user fills in and X's off; they're not linked
/// to hour-goals (a possible future option).
/// </summary>
public class BingoBoard
{
    public int Id { get; set; }
    public int Year { get; set; }
    public string? Title { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public List<BingoSquare> Squares { get; set; } = new();
}

public class BingoSquare
{
    public int Id { get; set; }
    public int BoardId { get; set; }
    public BingoBoard? Board { get; set; }
    public int Position { get; set; }              // 0–24 (row = pos/5, col = pos%5)
    public string Label { get; set; } = "";        // empty = blank square (can't be completed)
    public string? Note { get; set; }
    public bool Completed { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
}
