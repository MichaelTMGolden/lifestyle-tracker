using Microsoft.EntityFrameworkCore;
using PersonalDashboard.Api;
using PersonalDashboard.Api.Data;
using PersonalDashboard.Api.Domain;
using PersonalDashboard.Api.Alerts;
using PersonalDashboard.Api.Garmin;
using PersonalDashboard.Api.Goals;
using PersonalDashboard.Api.Integrations;
using PersonalDashboard.Api.Nutrition;
using PersonalDashboard.Api.Schedule;

namespace PersonalDashboard.Api.Endpoints;

public record WeightInput(double Value);
public record LoginInput(string Password);
public record HabitInput(string Name, bool TracksTime);
public record MinutesInput(int Minutes);
public record GoalInput(string Name, int TargetHours, string? ColorHex, DateOnly? StartDate, List<int>? SourceHabitIds, DateOnly? TargetDate = null);
public record FoodEntryInput(
    DateOnly? Date, MealType? Meal, string Name, string? Brand, string Source, string? ExternalRef,
    string? ServingDescription, double Quantity, double? Grams,
    double Calories, double ProteinG, double CarbsG, double FatG,
    double FiberG = 0, double SugarG = 0, double SatFatG = 0,
    double SodiumMg = 0, double PotassiumMg = 0, double CalciumMg = 0, double IronMg = 0);

/// <summary>
/// Daily macro targets. Constant for now — the obvious place to make these
/// user-editable later (a settings row or a Goal-style record).
/// </summary>
public static class NutritionTargets
{
    public const double ProteinG = 150;
    public const double Calories = 2200;
}

public static class ApiEndpoints
{
    /// <summary>
    /// Consecutive days with a completed log ending at today. If today isn't
    /// logged yet we count up to yesterday, so an unlogged today doesn't zero a
    /// live streak. A gap (missed day) breaks it.
    /// </summary>
    private static int CurrentStreak(IEnumerable<DateOnly> completedDates, DateOnly today)
    {
        var set = completedDates as ISet<DateOnly> ?? completedDates.ToHashSet();
        var cursor = set.Contains(today) ? today : today.AddDays(-1);
        var n = 0;
        while (set.Contains(cursor)) { n++; cursor = cursor.AddDays(-1); }
        return n;
    }

    private static int SeverityRank(string severity) => severity switch
    {
        "Urgent" => 3, "Watch" => 2, "Info" => 1, _ => 0,
    };

    private static SourceKind ParseFoodSource(string? source) => source switch
    {
        "OpenFoodFacts" => SourceKind.OpenFoodFacts,
        "Usda" or "USDA" => SourceKind.Usda,
        _ => SourceKind.Manual,
    };

    private static async Task<DataSource> GetOrCreateSourceAsync(AppDbContext db, SourceKind kind, string name)
    {
        var src = await db.DataSources.FirstOrDefaultAsync(s => s.Kind == kind && s.Name == name);
        if (src is null) { src = new DataSource { Name = name, Kind = kind }; db.DataSources.Add(src); await db.SaveChangesAsync(); }
        return src;
    }

    private static Task<DataSource> GetFoodSourceAsync(AppDbContext db, SourceKind kind) => GetOrCreateSourceAsync(db, kind, kind switch
    {
        SourceKind.OpenFoodFacts => "Open Food Facts",
        SourceKind.Usda => "USDA FoodData Central",
        _ => "Manual entry",
    });

    /// <summary>Dedicated source that holds the materialized daily macro totals.</summary>
    private const string RollupSourceName = "Nutrition (rollup)";

    /// <summary>
    /// Recompute a day's macro totals from its FoodEntry rows and materialize them
    /// into MetricSample (calories_in / protein_g / carbs_g / fat_g) at the day's
    /// UTC midnight, under the dedicated rollup source. Upsert is keyed on the
    /// unique (DataSourceId, MetricKey, RecordedAt) index so re-running is
    /// idempotent. With no entries left, the day's rollup rows are removed.
    /// </summary>
    private static async Task RecomputeDayRollupAsync(AppDbContext db, DateOnly date)
    {
        var src = await GetOrCreateSourceAsync(db, SourceKind.Manual, RollupSourceName);
        var dayStart = new DateTimeOffset(date.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);
        var keys = new[]
        {
            "calories_in", "protein_g", "carbs_g", "fat_g",
            "fiber_g", "sugar_g", "sat_fat_g", "sodium_mg", "potassium_mg", "calcium_mg", "iron_mg",
        };

        var entries = await db.FoodEntries.Where(e => e.Date == date).ToListAsync();
        if (entries.Count == 0)
        {
            await db.MetricSamples
                .Where(m => m.DataSourceId == src.Id && m.RecordedAt == dayStart && keys.Contains(m.MetricKey))
                .ExecuteDeleteAsync();
            return;
        }

        var rows = new[]
        {
            ("calories_in",  entries.Sum(e => e.Calories),    "kcal"),
            ("protein_g",    entries.Sum(e => e.ProteinG),    "g"),
            ("carbs_g",      entries.Sum(e => e.CarbsG),      "g"),
            ("fat_g",        entries.Sum(e => e.FatG),        "g"),
            ("fiber_g",      entries.Sum(e => e.FiberG),      "g"),
            ("sugar_g",      entries.Sum(e => e.SugarG),      "g"),
            ("sat_fat_g",    entries.Sum(e => e.SatFatG),     "g"),
            ("sodium_mg",    entries.Sum(e => e.SodiumMg),    "mg"),
            ("potassium_mg", entries.Sum(e => e.PotassiumMg), "mg"),
            ("calcium_mg",   entries.Sum(e => e.CalciumMg),   "mg"),
            ("iron_mg",      entries.Sum(e => e.IronMg),      "mg"),
        };
        await MetricSampleUpsert.UpsertAsync(db, rows.Select(r => new MetricSample
        {
            DataSourceId = src.Id, MetricKey = r.Item1, RecordedAt = dayStart,
            Value = Math.Round(r.Item2, 1), Unit = r.Item3,
        }));
    }

    public static void MapApiEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api");

        // --- Dashboard summary: one call the frontend can render a homepage from ---
        api.MapGet("/summary", async (AppDbContext db) =>
        {
            var today = DateOnly.FromDateTime(DateTime.UtcNow.Date);
            var weekAgo = DateTimeOffset.UtcNow.AddDays(-7);
            var now = DateTimeOffset.UtcNow;

            var latestWeight = await db.MetricSamples
                .Where(m => m.MetricKey == "weight_kg")
                .OrderByDescending(m => m.RecordedAt)
                .Select(m => (double?)m.Value)
                .FirstOrDefaultAsync();

            var latestRestingHr = await db.MetricSamples
                .Where(m => m.MetricKey == "resting_hr")
                .OrderByDescending(m => m.RecordedAt)
                .Select(m => (double?)m.Value)
                .FirstOrDefaultAsync();

            var avgSleepHoursThisWeek = await db.MetricSamples
                .Where(m => m.MetricKey == "sleep_total_min" && m.RecordedAt >= weekAgo)
                .AverageAsync(m => (double?)m.Value);

            var stepsThisWeek = await db.MetricSamples
                .Where(m => m.MetricKey == "steps" && m.RecordedAt >= weekAgo)
                .SumAsync(m => (double?)m.Value) ?? 0;

            var workoutsThisWeek = await db.Workouts.CountAsync(w => w.StartedAt >= weekAgo);

            var habitsToday = await db.HabitLogs.CountAsync(l => l.Date == today && l.Completed);
            var habitsTotal = await db.Habits.CountAsync(h => !h.Archived);

            var openTodos = await db.TodoItems.CountAsync(t => t.CompletedAt == null);

            var upcomingEvents = await db.CalendarEvents
                .Where(e => e.StartsAt >= now)
                .OrderBy(e => e.StartsAt)
                .Take(5)
                .ToListAsync();

            return Results.Ok(new
            {
                latestWeightKg = latestWeight,
                latestRestingHr,
                avgSleepHoursThisWeek = avgSleepHoursThisWeek.HasValue
                    ? Math.Round(avgSleepHoursThisWeek.Value / 60.0, 1)
                    : (double?)null,
                stepsThisWeek = (long)stepsThisWeek,
                workoutsThisWeek,
                habitsCompletedToday = habitsToday,
                habitsTotal,
                openTodos,
                upcomingEvents,
            });
        });

        // --- List available metric keys (handy for building charts dynamically) ---
        api.MapGet("/metrics", async (AppDbContext db) =>
            await db.MetricSamples
                .GroupBy(m => new { m.MetricKey, m.Unit })
                .Select(g => new { key = g.Key.MetricKey, unit = g.Key.Unit, count = g.Count() })
                .OrderBy(x => x.key)
                .ToListAsync());

        // --- Per-night sleep breakdown for a stacked-bar chart ---
        api.MapGet("/sleep", async (AppDbContext db, int days = 30) =>
        {
            var since = DateTimeOffset.UtcNow.AddDays(-days);
            var rows = await db.MetricSamples
                .Where(m => m.RecordedAt >= since && new[]
                    { "sleep_deep_min", "sleep_light_min", "sleep_rem_min", "sleep_awake_min", "sleep_score" }
                    .Contains(m.MetricKey))
                .Select(m => new { m.MetricKey, m.RecordedAt, m.Value })
                .ToListAsync();

            return rows
                .GroupBy(r => DateOnly.FromDateTime(r.RecordedAt.UtcDateTime))
                .OrderBy(g => g.Key)
                .Select(g => new
                {
                    date = g.Key,
                    deep = g.Where(x => x.MetricKey == "sleep_deep_min").Sum(x => x.Value),
                    light = g.Where(x => x.MetricKey == "sleep_light_min").Sum(x => x.Value),
                    rem = g.Where(x => x.MetricKey == "sleep_rem_min").Sum(x => x.Value),
                    awake = g.Where(x => x.MetricKey == "sleep_awake_min").Sum(x => x.Value),
                    score = g.Where(x => x.MetricKey == "sleep_score").Select(x => (double?)x.Value).FirstOrDefault(),
                })
                .ToList();
        });

        // --- Metrics: time series for charting ---
        api.MapGet("/metrics/{key}", async (string key, AppDbContext db, int days = 90) =>
        {
            var since = DateTimeOffset.UtcNow.AddDays(-days);
            var data = await db.MetricSamples
                .Where(m => m.MetricKey == key && m.RecordedAt >= since)
                .OrderBy(m => m.RecordedAt)
                .Select(m => new { m.RecordedAt, m.Value, m.Unit })
                .ToListAsync();
            return Results.Ok(data);
        });

        // --- Weekly schedule (recurring template) ---
        api.MapGet("/schedule/week", async (AppDbContext db) =>
        {
            var blocks = await db.ScheduleBlocks.AsNoTracking()
                .OrderBy(b => b.Day).ThenBy(b => b.StartMinutes)
                .ToListAsync();
            return blocks
                .GroupBy(b => b.Day)
                .OrderBy(g => ((int)g.Key + 6) % 7) // Monday-first
                .Select(g => new { day = g.Key.ToString(), blocks = g })
                .ToList();
        });

        // --- Today's schedule with calendar precedence ---
        api.MapGet("/schedule/today", async (AppDbContext db, HttpRequest req) =>
        {
            var clock = ClientClock.From(req);
            var todayStart = clock.TodayStartUtc;
            var todayEnd = clock.TodayEndUtc;
            var dow = clock.DayOfWeek;

            var blocks = await db.ScheduleBlocks.AsNoTracking()
                .Where(b => b.Day == dow)
                .OrderBy(b => b.StartMinutes)
                .ToListAsync();

            var events = await db.CalendarEvents.AsNoTracking()
                .Where(e => e.StartsAt < todayEnd && e.EndsAt > todayStart)
                .OrderBy(e => e.StartsAt)
                .ToListAsync();

            // Calendar events are returned as their own list (rendered once each,
            // spanning their range). A block carries only an `overlapped` flag so
            // the UI can dim it — we never copy event titles onto blocks.
            var annotated = blocks.Select(b =>
            {
                var overlapped = SchedulePrecedence.IsOverlapped(b.StartMinutes, b.DurationMinutes, todayStart, events);
                return new
                {
                    b.Id, b.StartMinutes, b.DurationMinutes, b.Activity, b.Notes,
                    category = b.Category.ToString(), b.Protected,
                    overlapped,
                };
            }).ToList();

            return Results.Ok(new { day = dow.ToString(), blocks = annotated, events });
        });

        // --- At-a-glance "today" rollup for the homepage ---
        api.MapGet("/today", async (AppDbContext db, HttpRequest req) =>
        {
            var clock = ClientClock.From(req);
            var todayStart = clock.TodayStartUtc;
            var todayEnd = clock.TodayEndUtc;
            var todayOnly = clock.Today;
            var nowMinutes = clock.NowMinutes;

            async Task<double> SumTodayAsync(string key) =>
                await db.MetricSamples
                    .Where(m => m.MetricKey == key && m.RecordedAt >= todayStart && m.RecordedAt < todayEnd)
                    .SumAsync(m => (double?)m.Value) ?? 0;

            var stepsToday = await SumTodayAsync("steps");
            var caloriesInToday = await SumTodayAsync("calories_in");

            var restingHr = await db.MetricSamples
                .Where(m => m.MetricKey == "resting_hr").OrderByDescending(m => m.RecordedAt)
                .Select(m => (double?)m.Value).FirstOrDefaultAsync();

            // Most recent night's sleep score (quality).
            var lastSleepScore = await db.MetricSamples
                .Where(m => m.MetricKey == "sleep_score").OrderByDescending(m => m.RecordedAt)
                .Select(m => (double?)m.Value).FirstOrDefaultAsync();

            var habitsTotal = await db.Habits.CountAsync(h => !h.Archived);
            var habitsCompletedToday = await db.HabitLogs.CountAsync(l => l.Date == todayOnly && l.Completed);

            var todosDueToday = await db.TodoItems.CountAsync(t =>
                t.CompletedAt == null && t.DueAt != null && t.DueAt >= todayStart && t.DueAt < todayEnd);
            var todosOverdue = await db.TodoItems.CountAsync(t =>
                t.CompletedAt == null && t.DueAt != null && t.DueAt < todayStart);

            // Recent 14-day sparklines + averages for the homepage health summary.
            async Task<List<double>> SparkAsync(string key) =>
                (await db.MetricSamples.AsNoTracking()
                    .Where(m => m.MetricKey == key)
                    .OrderByDescending(m => m.RecordedAt).Take(14)
                    .Select(m => m.Value).ToListAsync())
                .AsEnumerable().Reverse().ToList();

            var sleepSpark = await SparkAsync("sleep_score");
            var rhrSpark = await SparkAsync("resting_hr");
            var stepsSpark = await SparkAsync("steps");
            var sleepAvg14 = sleepSpark.Count > 0 ? Math.Round(sleepSpark.Average()) : (double?)null;
            var stressRecent = await db.MetricSamples.AsNoTracking()
                .Where(m => m.MetricKey == "stress_avg").OrderByDescending(m => m.RecordedAt).Take(7)
                .Select(m => (double?)m.Value).ToListAsync();
            var stressAvg = stressRecent.Count > 0 ? stressRecent.Average(v => v ?? 0) : 50;

            // Composite readiness from the signals we have (mirrors the Health page).
            var sleepComp = lastSleepScore ?? 60;
            var rhrComp = Math.Clamp(100 - ((restingHr ?? 55) - 55) * 8, 0, 100);
            var stressComp = Math.Clamp(100 - stressAvg, 0, 100);
            var readiness = (int)Math.Round(0.45 * sleepComp + 0.25 * rhrComp + 0.30 * stressComp);
            var readinessLabel = readiness >= 80 ? "Primed" : readiness >= 65 ? "Steady"
                : readiness >= 45 ? "Strained" : "Depleted";

            // Next-up from the schedule (current block if now is inside one, else the next).
            var dow = clock.DayOfWeek;
            var todays = await db.ScheduleBlocks.AsNoTracking().Where(b => b.Day == dow)
                .OrderBy(b => b.StartMinutes).ToListAsync();
            var current = todays.LastOrDefault(b => b.StartMinutes <= nowMinutes &&
                nowMinutes < b.StartMinutes + (b.DurationMinutes ?? 0));
            var next = todays.FirstOrDefault(b => b.StartMinutes > nowMinutes);

            // Tomorrow's first block (for the evening wind-down preview).
            var tomorrowDow = (DayOfWeek)(((int)dow + 1) % 7);
            var tomorrowFirst = await db.ScheduleBlocks.AsNoTracking()
                .Where(b => b.Day == tomorrowDow).OrderBy(b => b.StartMinutes)
                .Select(b => new { b.Activity, b.StartMinutes })
                .FirstOrDefaultAsync();

            return Results.Ok(new
            {
                stepsToday = (long)stepsToday,
                caloriesInToday = (long)caloriesInToday,
                restingHr,
                lastSleepScore = lastSleepScore.HasValue ? Math.Round(lastSleepScore.Value) : (double?)null,
                sleepAvg14,
                sleepSpark,
                rhrSpark,
                stepsSpark,
                readiness,
                readinessLabel,
                habitsCompletedToday,
                habitsTotal,
                todosDueToday,
                todosOverdue,
                nowMinutes,
                current = current == null ? null : new
                {
                    current.Activity,
                    current.StartMinutes,
                    current.DurationMinutes,
                    category = current.Category.ToString(),
                },
                next = next == null ? null : new
                {
                    next.Activity,
                    next.StartMinutes,
                    category = next.Category.ToString(),
                },
                tomorrowFirst,
            });
        });

        // --- Connections (integration framework) ---
        api.MapGet("/connections", async (AppDbContext db, IEnumerable<IDataProvider> providers) =>
        {
            var list = new List<object>();
            foreach (var p in providers)
            {
                var kind = p.Kind;
                var ds = await db.DataSources.Where(s => s.Kind == kind)
                    .OrderByDescending(s => s.LastSyncedAt).FirstOrDefaultAsync();
                int records = kind switch
                {
                    SourceKind.GoogleCalendar => await db.CalendarEvents.CountAsync(),
                    SourceKind.Spotify => await db.MusicPlays.CountAsync(),
                    _ => await db.MetricSamples.CountAsync(m =>
                        db.DataSources.Where(s => s.Kind == kind).Select(s => s.Id).Contains(m.DataSourceId)),
                };
                list.Add(new
                {
                    kind = kind.ToString(), name = p.Name, mode = p.Mode.ToString(),
                    configured = p.Configured, status = p.Status,
                    lastSyncedAt = ds?.LastSyncedAt, records,
                });
            }
            return list;
        });

        api.MapPost("/connections/{kind}/sync", async (string kind, AppDbContext db, HttpRequest req, IEnumerable<IDataProvider> providers) =>
        {
            if (!Enum.TryParse<SourceKind>(kind, true, out var k)) return Results.NotFound();
            var p = providers.FirstOrDefault(x => x.Kind == k);
            if (p is null) return Results.NotFound();
            var result = await p.SyncAsync(db, ClientClock.From(req).OffsetMinutes);
            if (result.Ok)
            {
                var ds = await db.DataSources.FirstOrDefaultAsync(s => s.Kind == k);
                if (ds is not null) { ds.LastSyncedAt = DateTimeOffset.UtcNow; await db.SaveChangesAsync(); }
            }
            return Results.Ok(result);
        });

        // Productionised import: upload Garmin Connect export files, then ingest.
        api.MapPost("/connections/garmin/import", async (HttpRequest req, AppDbContext db, IEnumerable<IDataProvider> providers) =>
        {
            if (!req.HasFormContentType) return Results.BadRequest(new { error = "Expected a multipart file upload." });
            var garmin = providers.OfType<GarminImportProvider>().FirstOrDefault();
            if (garmin is null) return Results.Problem("Garmin provider not registered.");
            var dir = garmin.ImportDir;
            Directory.CreateDirectory(dir);

            var form = await req.ReadFormAsync();
            var saved = 0;
            foreach (var f in form.Files)
            {
                var name = Path.GetFileName(f.FileName);
                if (string.IsNullOrWhiteSpace(name) || !name.EndsWith(".csv", StringComparison.OrdinalIgnoreCase)) continue;
                await using var fs = File.Create(Path.Combine(dir, name));
                await f.CopyToAsync(fs);
                saved++;
            }
            if (saved == 0) return Results.BadRequest(new { error = "No .csv files in the upload." });

            var r = await new GarminCsvImporter(db).ImportAsync(dir);
            var ds = await db.DataSources.FirstOrDefaultAsync(s => s.Kind == SourceKind.Garmin);
            if (ds is not null) { ds.LastSyncedAt = DateTimeOffset.UtcNow; await db.SaveChangesAsync(); }
            return Results.Ok(new { ok = true, filesSaved = saved, records = r.SamplesWritten,
                message = $"{r.HealthDays} health days · {r.SleepDays} sleep days · {r.SamplesWritten} samples written." });
        }).DisableAntiforgery();

        // --- Manual weight entry ---
        api.MapPost("/weight", async (WeightInput input, AppDbContext db, HttpRequest req) =>
        {
            if (input.Value < 30 || input.Value > 300) return Results.BadRequest(new { error = "Out of range" });
            var source = await db.DataSources.FirstOrDefaultAsync(s => s.Kind == SourceKind.Manual)
                ?? new DataSource { Name = "Manual entry", Kind = SourceKind.Manual };
            if (source.Id == 0) { db.DataSources.Add(source); await db.SaveChangesAsync(); }

            var clock = ClientClock.From(req);
            var dayStart = clock.TodayStartUtc;
            var when = dayStart.AddHours(7);
            // Replace any existing manual weight for today so re-entry overwrites.
            await db.MetricSamples
                .Where(m => m.MetricKey == "weight_kg" && m.DataSourceId == source.Id
                    && m.RecordedAt >= dayStart && m.RecordedAt < clock.TodayEndUtc)
                .ExecuteDeleteAsync();
            db.MetricSamples.Add(new MetricSample
            {
                DataSourceId = source.Id, MetricKey = "weight_kg",
                RecordedAt = when, Value = Math.Round(input.Value, 1), Unit = "kg",
            });
            await db.SaveChangesAsync();
            return Results.Ok(new { ok = true, value = Math.Round(input.Value, 1) });
        });

        // --- Workouts ---
        api.MapGet("/workouts", async (AppDbContext db, int take = 50) =>
            await db.Workouts.AsNoTracking().OrderByDescending(w => w.StartedAt).Take(take).ToListAsync());

        // --- Recently played music ---
        api.MapGet("/music/recent", async (AppDbContext db, int take = 50) =>
            await db.MusicPlays.AsNoTracking().OrderByDescending(p => p.PlayedAt).Take(take).ToListAsync());

        // --- Calendar ---
        api.MapGet("/calendar/upcoming", async (AppDbContext db, int days = 14) =>
        {
            var now = DateTimeOffset.UtcNow;
            var until = now.AddDays(days);
            return await db.CalendarEvents.AsNoTracking()
                .Where(e => e.StartsAt >= now && e.StartsAt <= until)
                .OrderBy(e => e.StartsAt)
                .ToListAsync();
        });

        // --- Habits ---
        api.MapGet("/habits", async (AppDbContext db, HttpRequest req) =>
        {
            var today = ClientClock.From(req).Today;
            var since = today.AddDays(-30);
            // Materialise per-habit completed dates so currentStreak can be
            // computed in memory (consecutive-day logic doesn't translate to SQL).
            var rows = await db.Habits
                .Where(h => !h.Archived)
                .OrderBy(h => h.Id)
                .Select(h => new
                {
                    h.Id,
                    h.Name,
                    h.Cadence,
                    h.TracksTime,
                    last30Completed = h.Logs.Count(l => l.Date >= since && l.Completed),
                    doneToday = h.Logs.Any(l => l.Date == today && l.Completed),
                    minutesToday = h.Logs.Where(l => l.Date == today).Sum(l => (int?)l.Minutes) ?? 0,
                    totalMinutes = h.Logs.Sum(l => (int?)l.Minutes) ?? 0,
                    totalCompletions = h.Logs.Count(l => l.Completed),
                    completedDates = h.Logs.Where(l => l.Completed).Select(l => l.Date).ToList(),
                })
                .ToListAsync();

            return rows.Select(h => new
            {
                h.Id,
                h.Name,
                h.Cadence,
                h.TracksTime,
                h.last30Completed,
                h.doneToday,
                h.minutesToday,
                h.totalMinutes,
                h.totalCompletions,
                currentStreak = CurrentStreak(h.completedDates, today),
            });
        });

        // --- GitHub-style contribution data: active days (+minutes) per habit ---
        api.MapGet("/habits/heatmap", async (AppDbContext db, HttpRequest req, int days = 182) =>
        {
            var since = ClientClock.From(req).Today.AddDays(-days);
            return await db.Habits
                .Where(h => !h.Archived)
                .OrderBy(h => h.Id)
                .Select(h => new
                {
                    h.Id,
                    h.Name,
                    h.TracksTime,
                    // presence = "on"; minutes drives intensity shading for timed skills
                    days = h.Logs.Where(l => l.Date >= since && l.Completed)
                        .Select(l => new { l.Date, l.Minutes })
                        .ToList(),
                    // kept for backward compatibility with existing callers
                    completedDates = h.Logs.Where(l => l.Date >= since && l.Completed)
                        .Select(l => l.Date)
                        .ToList(),
                })
                .ToListAsync();
        });

        api.MapPost("/habits/{id:int}/toggle", async (int id, AppDbContext db, HttpRequest req) =>
        {
            var today = ClientClock.From(req).Today;
            var log = await db.HabitLogs.FirstOrDefaultAsync(l => l.HabitId == id && l.Date == today);
            if (log is null)
            {
                log = new HabitLog { HabitId = id, Date = today, Completed = true };
                db.HabitLogs.Add(log);
            }
            else
            {
                log.Completed = !log.Completed;
            }
            await db.SaveChangesAsync();
            return Results.Ok(new { log.HabitId, log.Date, log.Completed, log.Minutes });
        });

        // Add practice minutes to today (quick-add buttons + timer-on-stop).
        // Upserts today's log (respecting the unique (HabitId, Date) index) and
        // marks the day done.
        api.MapPost("/habits/{id:int}/log-time", async (int id, MinutesInput body, AppDbContext db, HttpRequest req) =>
        {
            if (body.Minutes <= 0 || body.Minutes > 1440)
                return Results.BadRequest(new { message = "minutes must be between 1 and 1440" });
            if (!await db.Habits.AnyAsync(h => h.Id == id)) return Results.NotFound();

            var today = ClientClock.From(req).Today;
            var log = await db.HabitLogs.FirstOrDefaultAsync(l => l.HabitId == id && l.Date == today);
            if (log is null)
            {
                log = new HabitLog { HabitId = id, Date = today, Completed = true, Minutes = body.Minutes };
                db.HabitLogs.Add(log);
            }
            else
            {
                log.Minutes += body.Minutes;
                log.Completed = true;
            }
            await db.SaveChangesAsync();
            return Results.Ok(new { log.HabitId, log.Date, log.Minutes, log.Completed });
        });

        // Set today's minutes to an absolute value (corrections). Completed = minutes > 0.
        api.MapPut("/habits/{id:int}/today", async (int id, MinutesInput body, AppDbContext db, HttpRequest req) =>
        {
            if (body.Minutes < 0 || body.Minutes > 1440)
                return Results.BadRequest(new { message = "minutes must be between 0 and 1440" });
            if (!await db.Habits.AnyAsync(h => h.Id == id)) return Results.NotFound();

            var today = ClientClock.From(req).Today;
            var log = await db.HabitLogs.FirstOrDefaultAsync(l => l.HabitId == id && l.Date == today);
            if (log is null)
            {
                log = new HabitLog { HabitId = id, Date = today, Minutes = body.Minutes, Completed = body.Minutes > 0 };
                db.HabitLogs.Add(log);
            }
            else
            {
                log.Minutes = body.Minutes;
                log.Completed = body.Minutes > 0;
            }
            await db.SaveChangesAsync();
            return Results.Ok(new { log.HabitId, log.Date, log.Minutes, log.Completed });
        });

        // Flip whether a skill tracks time.
        api.MapPost("/habits/{id:int}/tracks-time", async (int id, AppDbContext db) =>
        {
            var habit = await db.Habits.FindAsync(id);
            if (habit is null) return Results.NotFound();
            habit.TracksTime = !habit.TracksTime;
            await db.SaveChangesAsync();
            return Results.Ok(new { habit.Id, habit.TracksTime });
        });

        // Add a new tracked practice (e.g. "Exercise").
        api.MapPost("/habits", async (HabitInput input, AppDbContext db) =>
        {
            var name = input.Name?.Trim();
            if (string.IsNullOrEmpty(name)) return Results.BadRequest(new { error = "Name required" });
            if (await db.Habits.AnyAsync(h => h.Name == name && !h.Archived))
                return Results.Conflict(new { error = "A habit with that name already exists" });
            var habit = new Habit { Name = name, TracksTime = input.TracksTime };
            db.Habits.Add(habit);
            await db.SaveChangesAsync();
            return Results.Created($"/api/habits/{habit.Id}", new { habit.Id, habit.Name, habit.TracksTime });
        });

        // Remove a habit (cascades its logs and goal-feeder links).
        api.MapDelete("/habits/{id:int}", async (int id, AppDbContext db) =>
        {
            var habit = await db.Habits.FindAsync(id);
            if (habit is null) return Results.NotFound();
            db.Habits.Remove(habit);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // --- Goals (hour targets fed by one or more skills) ---
        api.MapGet("/goals", (AppDbContext db, HttpRequest req) =>
            GoalPacingService.ComputeAsync(db, ClientClock.From(req).Today));

        api.MapPost("/goals", async (GoalInput input, AppDbContext db) =>
        {
            var goal = new Goal
            {
                Name = input.Name,
                TargetMinutes = Math.Max(0, input.TargetHours) * 60,
                ColorHex = input.ColorHex,
                StartDate = input.StartDate,
                TargetDate = input.TargetDate,
                Sources = (input.SourceHabitIds ?? new())
                    .Distinct().Select(hid => new GoalSource { HabitId = hid }).ToList(),
            };
            db.Goals.Add(goal);
            await db.SaveChangesAsync();
            return Results.Created($"/api/goals/{goal.Id}", new { goal.Id });
        });

        api.MapPut("/goals/{id:int}", async (int id, GoalInput input, AppDbContext db) =>
        {
            var goal = await db.Goals.Include(g => g.Sources).FirstOrDefaultAsync(g => g.Id == id);
            if (goal is null) return Results.NotFound();

            goal.Name = input.Name;
            goal.TargetMinutes = Math.Max(0, input.TargetHours) * 60;
            goal.ColorHex = input.ColorHex;
            goal.StartDate = input.StartDate;
            goal.TargetDate = input.TargetDate;

            db.GoalSources.RemoveRange(goal.Sources);
            goal.Sources = (input.SourceHabitIds ?? new())
                .Distinct().Select(hid => new GoalSource { GoalId = goal.Id, HabitId = hid }).ToList();

            await db.SaveChangesAsync();
            return Results.Ok(new { goal.Id });
        });

        api.MapDelete("/goals/{id:int}", async (int id, AppDbContext db) =>
        {
            var goal = await db.Goals.FindAsync(id);
            if (goal is null) return Results.NotFound();
            db.Goals.Remove(goal);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // --- Alerts (anomaly / pattern detection) ---
        // GET runs a staleness-guarded regeneration (≤ once/hour); refresh forces it.
        api.MapGet("/alerts", async (AppDbContext db, AlertService alerts, HttpRequest req, string? status) =>
        {
            await alerts.GenerateIfStaleAsync(db, ClientClock.From(req));
            var query = db.Alerts.AsNoTracking();
            if (status != "all") query = query.Where(a => a.Status != "Dismissed");
            var list = await query.ToListAsync();
            return list.OrderByDescending(a => SeverityRank(a.Severity)).ThenByDescending(a => a.DetectedAt);
        });

        api.MapPost("/alerts/refresh", async (AppDbContext db, AlertService alerts, HttpRequest req) =>
        {
            await alerts.GenerateAlertsAsync(db, ClientClock.From(req));
            var list = await db.Alerts.AsNoTracking().Where(a => a.Status != "Dismissed").ToListAsync();
            return Results.Ok(list.OrderByDescending(a => SeverityRank(a.Severity)).ThenByDescending(a => a.DetectedAt));
        });

        api.MapPost("/alerts/{id:long}/dismiss", async (long id, AppDbContext db) =>
        {
            var a = await db.Alerts.FindAsync(id);
            if (a is null) return Results.NotFound();
            a.Status = "Dismissed";
            a.DismissedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // --- Todos ---
        api.MapGet("/todos", async (AppDbContext db) =>
            await db.TodoItems.AsNoTracking().OrderBy(t => t.CompletedAt != null).ThenBy(t => t.Priority)
                .ThenBy(t => t.DueAt).ToListAsync());

        api.MapPost("/todos", async (TodoItem input, AppDbContext db) =>
        {
            input.Id = 0;
            input.CreatedAt = DateTimeOffset.UtcNow;
            input.CompletedAt = null;
            db.TodoItems.Add(input);
            await db.SaveChangesAsync();
            return Results.Created($"/api/todos/{input.Id}", input);
        });

        api.MapPost("/todos/{id:long}/toggle", async (long id, AppDbContext db) =>
        {
            var todo = await db.TodoItems.FindAsync(id);
            if (todo is null) return Results.NotFound();
            todo.CompletedAt = todo.CompletedAt is null ? DateTimeOffset.UtcNow : null;
            await db.SaveChangesAsync();
            return Results.Ok(todo);
        });

        api.MapPut("/todos/{id:long}", async (long id, TodoItem input, AppDbContext db) =>
        {
            var todo = await db.TodoItems.FindAsync(id);
            if (todo is null) return Results.NotFound();
            todo.Title = input.Title;
            todo.Notes = input.Notes;
            todo.Priority = input.Priority;
            todo.DueAt = input.DueAt;
            await db.SaveChangesAsync();
            return Results.Ok(todo);
        });

        api.MapDelete("/todos/{id:long}", async (long id, AppDbContext db) =>
        {
            var todo = await db.TodoItems.FindAsync(id);
            if (todo is null) return Results.NotFound();
            db.TodoItems.Remove(todo);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // --- Daily to-dos (today only, not long-term) ---
        // Pure read — no side effects (StrictMode/Promise.all/retries call this).
        // Prior-day cleanup runs at startup (Program.cs) and on create instead.
        api.MapGet("/daily-todos", async (AppDbContext db, HttpRequest req) =>
        {
            var today = ClientClock.From(req).Today;
            return await db.DailyTodos.AsNoTracking()
                .Where(t => t.Date == today)
                .OrderBy(t => t.Done).ThenBy(t => t.CreatedAt)
                .ToListAsync();
        });

        api.MapPost("/daily-todos", async (DailyTodo input, AppDbContext db, HttpRequest req) =>
        {
            var today = ClientClock.From(req).Today;
            // Daily to-dos aren't kept long-term — purge previous days on create.
            await db.DailyTodos.Where(t => t.Date < today).ExecuteDeleteAsync();
            var item = new DailyTodo
            {
                Date = today,
                Title = input.Title,
                CreatedAt = DateTimeOffset.UtcNow,
            };
            db.DailyTodos.Add(item);
            await db.SaveChangesAsync();
            return Results.Created($"/api/daily-todos/{item.Id}", item);
        });

        api.MapPost("/daily-todos/{id:long}/toggle", async (long id, AppDbContext db) =>
        {
            var item = await db.DailyTodos.FindAsync(id);
            if (item is null) return Results.NotFound();
            item.Done = !item.Done;
            await db.SaveChangesAsync();
            return Results.Ok(item);
        });

        api.MapDelete("/daily-todos/{id:long}", async (long id, AppDbContext db) =>
        {
            var item = await db.DailyTodos.FindAsync(id);
            if (item is null) return Results.NotFound();
            db.DailyTodos.Remove(item);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // --- Food search (server-side proxy over Open Food Facts + USDA) ---
        api.MapGet("/food/search", async (FoodSearchService svc, string? q, string? country, CancellationToken ct) =>
            Results.Ok(await svc.SearchAsync(q ?? "", country ?? "ie", ct)));

        // --- Nutrition: per-food logging + materialized daily rollup ---
        api.MapGet("/nutrition/day", async (AppDbContext db, HttpRequest req, string? date) =>
        {
            var clock = ClientClock.From(req);
            var d = date is not null && DateOnly.TryParse(date, out var pd) ? pd : clock.Today;
            var entries = await db.FoodEntries.AsNoTracking()
                .Where(e => e.Date == d)
                .OrderBy(e => e.Meal).ThenBy(e => e.LoggedAt)
                .Select(e => new
                {
                    e.Id, e.DataSourceId, e.Date, e.LoggedAt, e.Name, e.Brand, e.ExternalRef,
                    e.ServingDescription, e.Quantity, e.Grams, e.Meal,
                    e.Calories, e.ProteinG, e.CarbsG, e.FatG,
                    e.FiberG, e.SugarG, e.SatFatG, e.SodiumMg, e.PotassiumMg, e.CalciumMg, e.IronMg,
                    source = e.DataSource!.Kind, // serialized as the SourceKind name → client echoes it on edit
                })
                .ToListAsync();
            return Results.Ok(new
            {
                date = d.ToString("yyyy-MM-dd"),
                entries,
                totals = new
                {
                    calories = Math.Round(entries.Sum(e => e.Calories), 1),
                    proteinG = Math.Round(entries.Sum(e => e.ProteinG), 1),
                    carbsG = Math.Round(entries.Sum(e => e.CarbsG), 1),
                    fatG = Math.Round(entries.Sum(e => e.FatG), 1),
                    fiberG = Math.Round(entries.Sum(e => e.FiberG), 1),
                    sugarG = Math.Round(entries.Sum(e => e.SugarG), 1),
                    satFatG = Math.Round(entries.Sum(e => e.SatFatG), 1),
                    sodiumMg = Math.Round(entries.Sum(e => e.SodiumMg)),
                    potassiumMg = Math.Round(entries.Sum(e => e.PotassiumMg)),
                    calciumMg = Math.Round(entries.Sum(e => e.CalciumMg)),
                    ironMg = Math.Round(entries.Sum(e => e.IronMg), 1),
                },
                targets = new { proteinG = NutritionTargets.ProteinG, calories = NutritionTargets.Calories },
            });
        });

        api.MapPost("/nutrition/entries", async (FoodEntryInput input, AppDbContext db, HttpRequest req) =>
        {
            if (string.IsNullOrWhiteSpace(input.Name)) return Results.BadRequest(new { error = "Name required" });
            var clock = ClientClock.From(req);
            var date = input.Date ?? clock.Today;
            var src = await GetFoodSourceAsync(db, ParseFoodSource(input.Source));
            var entry = new FoodEntry
            {
                DataSourceId = src.Id, Date = date, LoggedAt = DateTimeOffset.UtcNow,
                Name = input.Name.Trim(), Brand = input.Brand, ExternalRef = input.ExternalRef,
                ServingDescription = input.ServingDescription, Quantity = input.Quantity <= 0 ? 1 : input.Quantity,
                Grams = input.Grams, Meal = input.Meal ?? MealType.Other,
                Calories = input.Calories, ProteinG = input.ProteinG, CarbsG = input.CarbsG, FatG = input.FatG,
                FiberG = input.FiberG, SugarG = input.SugarG, SatFatG = input.SatFatG,
                SodiumMg = input.SodiumMg, PotassiumMg = input.PotassiumMg, CalciumMg = input.CalciumMg, IronMg = input.IronMg,
            };
            db.FoodEntries.Add(entry);
            await db.SaveChangesAsync();
            await RecomputeDayRollupAsync(db, date);
            return Results.Created($"/api/nutrition/entries/{entry.Id}", entry);
        });

        api.MapPut("/nutrition/entries/{id:long}", async (long id, FoodEntryInput input, AppDbContext db) =>
        {
            var entry = await db.FoodEntries.FindAsync(id);
            if (entry is null) return Results.NotFound();
            var oldDate = entry.Date;
            var newDate = input.Date ?? entry.Date;
            var src = await GetFoodSourceAsync(db, ParseFoodSource(input.Source));

            entry.DataSourceId = src.Id; entry.Date = newDate;
            entry.Name = input.Name.Trim(); entry.Brand = input.Brand; entry.ExternalRef = input.ExternalRef;
            entry.ServingDescription = input.ServingDescription; entry.Quantity = input.Quantity <= 0 ? 1 : input.Quantity;
            entry.Grams = input.Grams; entry.Meal = input.Meal ?? entry.Meal;
            entry.Calories = input.Calories; entry.ProteinG = input.ProteinG; entry.CarbsG = input.CarbsG; entry.FatG = input.FatG;
            entry.FiberG = input.FiberG; entry.SugarG = input.SugarG; entry.SatFatG = input.SatFatG;
            entry.SodiumMg = input.SodiumMg; entry.PotassiumMg = input.PotassiumMg; entry.CalciumMg = input.CalciumMg; entry.IronMg = input.IronMg;
            await db.SaveChangesAsync();

            await RecomputeDayRollupAsync(db, oldDate);
            if (newDate != oldDate) await RecomputeDayRollupAsync(db, newDate);
            return Results.Ok(entry);
        });

        api.MapDelete("/nutrition/entries/{id:long}", async (long id, AppDbContext db) =>
        {
            var entry = await db.FoodEntries.FindAsync(id);
            if (entry is null) return Results.NotFound();
            var date = entry.Date;
            db.FoodEntries.Remove(entry);
            await db.SaveChangesAsync();
            await RecomputeDayRollupAsync(db, date);
            return Results.NoContent();
        });
    }
}
