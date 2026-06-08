using Bogus;
using Microsoft.EntityFrameworkCore;
using PersonalDashboard.Api.Domain;
using PersonalDashboard.Api.Schedule;

namespace PersonalDashboard.Api.Data;

/// <summary>
/// Fills the database with ~90 days of plausible dummy data so the dashboard
/// looks alive in development. Idempotent: does nothing if data already exists.
/// Swap individual sections for real integration syncs later.
/// </summary>
public static class DataSeeder
{
    private const int Days = 90;

    public static async Task SeedAsync(AppDbContext db)
    {
        // Schedule has its own guard so it seeds independently of the dummy data.
        await SeedScheduleAsync(db);
        // Goals/food depend on other rows existing; no-op on a fresh DB here and
        // are called again at the end once the base data is in place.
        await SeedGoalsAsync(db);
        await SeedFoodAsync(db);

        if (await db.DataSources.AnyAsync()) return;

        // Fixed seed => stable, reproducible dummy data across runs.
        Randomizer.Seed = new Random(1234);
        var today = DateTime.UtcNow.Date;
        var start = today.AddDays(-Days);

        // --- Data sources (stand-ins for the eventual real integrations) ---
        var manual = new DataSource { Name = "Manual entry", Kind = SourceKind.Manual };
        var garmin = new DataSource { Name = "Garmin (sample)", Kind = SourceKind.Garmin };
        var mfp = new DataSource { Name = "MyFitnessPal (sample)", Kind = SourceKind.MyFitnessPal };
        var spotify = new DataSource { Name = "Spotify (sample)", Kind = SourceKind.Spotify };
        var gcal = new DataSource { Name = "Google Calendar (sample)", Kind = SourceKind.GoogleCalendar };
        db.DataSources.AddRange(manual, garmin, mfp, spotify, gcal);
        await db.SaveChangesAsync();

        // --- Daily metrics: weight, resting HR, steps, sleep, calories in ---
        var weight = 78.0;
        var samples = new List<MetricSample>();
        for (var d = 0; d < Days; d++)
        {
            var day = start.AddDays(d);
            weight += Randomizer.Seed.NextDouble() * 0.4 - 0.22; // slow downward drift + noise
            // Steps, resting HR and sleep come from the real Garmin import
            // (GarminCsvImporter), so they're intentionally not faked here.
            // Weight and calories aren't in the Garmin export, so keep them.
            samples.Add(Sample(manual.Id, "weight_kg", day.AddHours(7), Math.Round(weight, 1), "kg"));
            samples.Add(Sample(mfp.Id, "calories_in", day.AddHours(21), Randomizer.Seed.Next(1700, 2900), "kcal"));
        }
        db.MetricSamples.AddRange(samples);

        // --- Workouts (~4/week) ---
        var workoutTypes = new[] { "Run", "Strength", "Cycling", "Swim", "Walk" };
        var workouts = new List<Workout>();
        for (var d = 0; d < Days; d++)
        {
            if (Randomizer.Seed.NextDouble() > 0.55) continue;
            var day = start.AddDays(d);
            var type = workoutTypes[Randomizer.Seed.Next(workoutTypes.Length)];
            var duration = Randomizer.Seed.Next(25, 95);
            workouts.Add(new Workout
            {
                DataSourceId = garmin.Id,
                Type = type,
                StartedAt = new DateTimeOffset(day.AddHours(Randomizer.Seed.Next(6, 19)), TimeSpan.Zero),
                DurationMinutes = duration,
                DistanceMeters = type is "Run" or "Cycling" or "Walk" or "Swim"
                    ? Math.Round(duration * Randomizer.Seed.Next(120, 320) / 1.0)
                    : null,
                Calories = duration * Randomizer.Seed.Next(7, 13),
                AverageHeartRate = Randomizer.Seed.Next(110, 165),
            });
        }
        db.Workouts.AddRange(workouts);

        // --- Music plays (Spotify stand-in) ---
        var trackFaker = new Faker<MusicPlay>()
            .RuleFor(x => x.DataSourceId, _ => spotify.Id)
            .RuleFor(x => x.TrackName, f => f.Lorem.Sentence(f.Random.Int(1, 4)).TrimEnd('.'))
            .RuleFor(x => x.Artist, f => f.Name.FullName())
            .RuleFor(x => x.Album, f => f.Lorem.Sentence(2).TrimEnd('.'))
            .RuleFor(x => x.DurationMs, f => f.Random.Int(120_000, 300_000))
            .RuleFor(x => x.PlayedAt, f => new DateTimeOffset(
                f.Date.Between(start, today), TimeSpan.Zero));
        db.MusicPlays.AddRange(trackFaker.Generate(600));

        // --- Calendar events ---
        var eventTitles = new[]
        {
            "Standup", "1:1 with manager", "Gym session", "Dentist", "Project sync",
            "Dinner with friends", "Code review", "Planning", "Focus block", "Doctor",
        };
        var events = new List<CalendarEvent>();
        for (var d = 0; d < Days + 14; d++) // include some future events
        {
            var day = start.AddDays(d);
            var count = Randomizer.Seed.Next(0, 4);
            for (var i = 0; i < count; i++)
            {
                var hour = Randomizer.Seed.Next(8, 19);
                var startAt = new DateTimeOffset(day.AddHours(hour), TimeSpan.Zero);
                events.Add(new CalendarEvent
                {
                    DataSourceId = gcal.Id,
                    ExternalId = Guid.NewGuid().ToString(),
                    Title = eventTitles[Randomizer.Seed.Next(eventTitles.Length)],
                    StartsAt = startAt,
                    EndsAt = startAt.AddMinutes(Randomizer.Seed.Next(30, 120)),
                    AllDay = false,
                    Location = Randomizer.Seed.NextDouble() > 0.6 ? "Office" : null,
                });
            }
        }
        db.CalendarEvents.AddRange(events);

        // --- Habits + logs ---
        // The four tracked practices the heatmap focuses on, plus daily anchors.
        // Each has a baseline completion rate so the contribution grids look
        // distinct and realistic.
        // Singing / Guitar / Writing accumulate practice minutes (feed the goals);
        // Reading / Mobility stay binary done/not-done.
        var habitDefs = new (string Name, double Rate, bool TracksTime)[]
        {
            ("Singing", 0.70, true),
            ("Guitar", 0.78, true),
            ("Writing", 0.55, true),
            ("Reading", 0.82, false),
            ("Mobility", 0.60, false),
        };
        var habits = habitDefs.Select(d => new Habit { Name = d.Name, TracksTime = d.TracksTime }).ToList();
        db.Habits.AddRange(habits);
        await db.SaveChangesAsync();

        // ~26 weeks of history so the GitHub-style heatmap has depth. Only
        // completed days are stored (absence == not done). Timed skills carry a
        // realistic per-day minutes value; the last 12 days are forced complete
        // so streaks are non-zero and goal progress is visibly populated.
        const int habitHistoryDays = 182;
        var habitStart = today.AddDays(-habitHistoryDays);
        var logs = new List<HabitLog>();
        for (var i = 0; i < habits.Count; i++)
        {
            var def = habitDefs[i];
            for (var d = 0; d <= habitHistoryDays; d++) // inclusive => ends today
            {
                var daysFromEnd = habitHistoryDays - d;
                var trend = 0.12 * (d / (double)habitHistoryDays); // recent weeks a touch stronger
                var completed = daysFromEnd < 12 || Randomizer.Seed.NextDouble() < def.Rate + trend - 0.06;
                if (!completed) continue;
                logs.Add(new HabitLog
                {
                    HabitId = habits[i].Id,
                    Date = DateOnly.FromDateTime(habitStart.AddDays(d)),
                    Completed = true,
                    Minutes = def.TracksTime ? Randomizer.Seed.Next(20, 91) : 0,
                });
            }
        }
        db.HabitLogs.AddRange(logs);

        // --- Long-term tasks ---
        var todoFaker = new Faker<TodoItem>()
            .RuleFor(x => x.Title, f => f.Hacker.Verb() + " " + f.Hacker.Noun())
            .RuleFor(x => x.Notes, f => f.Random.Bool(0.4f) ? f.Lorem.Sentence() : null)
            .RuleFor(x => x.Priority, f => f.Random.Int(1, 3))
            .RuleFor(x => x.CreatedAt, f => new DateTimeOffset(f.Date.Between(start, today), TimeSpan.Zero))
            .RuleFor(x => x.DueAt, f => f.Random.Bool(0.7f)
                ? new DateTimeOffset(f.Date.Between(today.AddDays(-5), today.AddDays(14)), TimeSpan.Zero)
                : null)
            .RuleFor(x => x.CompletedAt, (f, x) => f.Random.Bool(0.4f)
                ? x.CreatedAt.AddDays(f.Random.Int(0, 3))
                : null);
        db.TodoItems.AddRange(todoFaker.Generate(25));

        // --- Daily to-dos for today (ephemeral, what the dashboard previews) ---
        var nowOffset = new DateTimeOffset(today, TimeSpan.Zero);
        string[] dailySamples = { "Warm up voice 10 min", "Run alternate-picking drill", "Write one verse", "Read 20 pages", "Hydrate 2L" };
        var todayOnly = DateOnly.FromDateTime(today);
        for (var i = 0; i < dailySamples.Length; i++)
        {
            db.DailyTodos.Add(new DailyTodo
            {
                Date = todayOnly,
                Title = dailySamples[i],
                Done = i == dailySamples.Length - 1, // last one pre-checked
                CreatedAt = nowOffset.AddMinutes(i),
            });
        }

        await db.SaveChangesAsync();

        // Habits + sources now exist — seed example goals and recent food entries.
        await SeedGoalsAsync(db);
        await SeedFoodAsync(db);
    }

    /// <summary>
    /// Seeds a handful of food entries across the last few days (incl. today),
    /// mixing Manual / Open Food Facts / USDA sources with realistic macros, and
    /// materializes their daily rollups (calories_in / protein_g / carbs_g /
    /// fat_g). Drops the random MyFitnessPal calories_in on those same days so the
    /// rollup is the single source. No-op if food entries already exist (or the
    /// base sources aren't seeded yet).
    /// </summary>
    public static async Task SeedFoodAsync(AppDbContext db)
    {
        if (await db.FoodEntries.AnyAsync()) return;

        var manual = await db.DataSources.FirstOrDefaultAsync(s => s.Kind == SourceKind.Manual && s.Name == "Manual entry");
        if (manual is null) return; // base data not seeded yet — caller retries later

        var off = await GetOrCreateAsync(db, SourceKind.OpenFoodFacts, "Open Food Facts");
        var usda = await GetOrCreateAsync(db, SourceKind.Usda, "USDA FoodData Central");

        // A realistic daily menu (~1,800 kcal, ~150 g protein → near the protein target).
        // (name, brand, sourceId, serving, qty, kcal, protein, carbs, fat, fiber, sugar, satFat, sodium(mg), potassium(mg), calcium(mg), iron(mg), meal)
        var menu = new (string Name, string? Brand, int Src, string Serving, double Qty,
            double Kcal, double P, double C, double F,
            double Fib, double Sug, double Sat, double Na, double K, double Ca, double Fe, MealType Meal)[]
        {
            ("Porridge with banana", null, manual.Id, "1 bowl", 1, 320, 12, 52, 7, 6, 14, 1.5, 60, 480, 180, 2.5, MealType.Breakfast),
            ("Greek yogurt, natural", "Glenisk", off.Id, "170 g", 1, 140, 14, 9, 4, 0, 8, 2.5, 65, 240, 200, 0.1, MealType.Breakfast),
            ("Chicken breast, grilled", null, usda.Id, "180 g", 1, 297, 56, 0, 6, 0, 0, 1.8, 130, 460, 14, 1.0, MealType.Lunch),
            ("Brown rice, cooked", null, usda.Id, "200 g", 1, 248, 5, 52, 2, 3.2, 0.7, 0.4, 10, 160, 20, 0.8, MealType.Lunch),
            ("Salmon fillet, baked", null, usda.Id, "150 g", 1, 280, 40, 0, 13, 0, 0, 3.0, 90, 560, 18, 0.5, MealType.Dinner),
            ("Sweet potato, roasted", null, manual.Id, "200 g", 1, 180, 4, 41, 0, 6.6, 13, 0, 70, 950, 76, 1.2, MealType.Dinner),
            ("Protein bar", "Grenade", off.Id, "60 g bar", 1, 220, 20, 22, 7, 5, 2, 3.5, 200, 150, 120, 2.0, MealType.Snack),
            ("Banana", null, usda.Id, "1 medium", 1, 105, 1, 27, 0, 3.1, 14, 0.1, 1, 422, 6, 0.3, MealType.Snack),
        };

        var today = DateOnly.FromDateTime(DateTime.UtcNow.Date);
        const int foodDays = 6; // today and the previous five days
        var entries = new List<FoodEntry>();
        var dates = new List<DateOnly>();
        for (var d = 0; d < foodDays; d++)
        {
            var date = today.AddDays(-d);
            dates.Add(date);
            var factor = 1 + (d % 3 - 1) * 0.04; // gentle day-to-day variation so charts aren't flat
            var loggedBase = new DateTimeOffset(date.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);
            for (var i = 0; i < menu.Length; i++)
            {
                var m = menu[i];
                entries.Add(new FoodEntry
                {
                    DataSourceId = m.Src, Date = date, LoggedAt = loggedBase.AddHours(7 + i),
                    Name = m.Name, Brand = m.Brand, ServingDescription = m.Serving, Quantity = m.Qty,
                    Meal = m.Meal,
                    Calories = Math.Round(m.Kcal * factor), ProteinG = Math.Round(m.P * factor, 1),
                    CarbsG = Math.Round(m.C * factor, 1), FatG = Math.Round(m.F * factor, 1),
                    FiberG = Math.Round(m.Fib * factor, 1), SugarG = Math.Round(m.Sug * factor, 1),
                    SatFatG = Math.Round(m.Sat * factor, 1), SodiumMg = Math.Round(m.Na * factor),
                    PotassiumMg = Math.Round(m.K * factor), CalciumMg = Math.Round(m.Ca * factor),
                    IronMg = Math.Round(m.Fe * factor, 1),
                });
            }
        }
        db.FoodEntries.AddRange(entries);
        await db.SaveChangesAsync();

        // Materialize daily rollups under the dedicated source, and drop the random
        // MyFitnessPal calories_in on these days so there's a single source per day.
        var rollup = await GetOrCreateAsync(db, SourceKind.Manual, "Nutrition (rollup)");
        var mfp = await db.DataSources.FirstOrDefaultAsync(s => s.Kind == SourceKind.MyFitnessPal);
        var samples = new List<MetricSample>();
        foreach (var date in dates)
        {
            var dayStart = new DateTimeOffset(date.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);
            var dayEntries = entries.Where(e => e.Date == date).ToList();
            if (mfp is not null)
            {
                var dayEnd = dayStart.AddDays(1);
                await db.MetricSamples
                    .Where(s => s.DataSourceId == mfp.Id && s.MetricKey == "calories_in"
                        && s.RecordedAt >= dayStart && s.RecordedAt < dayEnd)
                    .ExecuteDeleteAsync();
            }
            samples.Add(RollupSample(rollup.Id, "calories_in", dayStart, dayEntries.Sum(e => e.Calories), "kcal"));
            samples.Add(RollupSample(rollup.Id, "protein_g", dayStart, dayEntries.Sum(e => e.ProteinG), "g"));
            samples.Add(RollupSample(rollup.Id, "carbs_g", dayStart, dayEntries.Sum(e => e.CarbsG), "g"));
            samples.Add(RollupSample(rollup.Id, "fat_g", dayStart, dayEntries.Sum(e => e.FatG), "g"));
            samples.Add(RollupSample(rollup.Id, "fiber_g", dayStart, dayEntries.Sum(e => e.FiberG), "g"));
            samples.Add(RollupSample(rollup.Id, "sugar_g", dayStart, dayEntries.Sum(e => e.SugarG), "g"));
            samples.Add(RollupSample(rollup.Id, "sat_fat_g", dayStart, dayEntries.Sum(e => e.SatFatG), "g"));
            samples.Add(RollupSample(rollup.Id, "sodium_mg", dayStart, dayEntries.Sum(e => e.SodiumMg), "mg"));
            samples.Add(RollupSample(rollup.Id, "potassium_mg", dayStart, dayEntries.Sum(e => e.PotassiumMg), "mg"));
            samples.Add(RollupSample(rollup.Id, "calcium_mg", dayStart, dayEntries.Sum(e => e.CalciumMg), "mg"));
            samples.Add(RollupSample(rollup.Id, "iron_mg", dayStart, dayEntries.Sum(e => e.IronMg), "mg"));
        }
        await MetricSampleUpsert.UpsertAsync(db, samples);
    }

    private static async Task<DataSource> GetOrCreateAsync(AppDbContext db, SourceKind kind, string name)
    {
        var src = await db.DataSources.FirstOrDefaultAsync(s => s.Kind == kind && s.Name == name);
        if (src is null) { src = new DataSource { Name = name, Kind = kind }; db.DataSources.Add(src); await db.SaveChangesAsync(); }
        return src;
    }

    private static MetricSample RollupSample(int sourceId, string key, DateTimeOffset at, double value, string unit) => new()
    {
        DataSourceId = sourceId, MetricKey = key, RecordedAt = at, Value = Math.Round(value, 1), Unit = unit,
    };

    /// <summary>
    /// Seeds two example goals: a single-skill "100h Guitar" and a composite
    /// "Frontman 1000h" fed by Singing + Guitar + Writing. No-op if goals
    /// already exist or no habits are present yet.
    /// </summary>
    public static async Task SeedGoalsAsync(AppDbContext db)
    {
        if (await db.Goals.AnyAsync()) return;

        var byName = await db.Habits.ToDictionaryAsync(h => h.Name, h => h.Id);
        if (byName.Count == 0) return;

        int? Id(string name) => byName.TryGetValue(name, out var id) ? id : null;
        var today = DateOnly.FromDateTime(DateTime.UtcNow.Date);

        var goals = new List<Goal>();

        // Single-skill goal. A recent StartDate keeps it visibly mid-progress
        // rather than already overflowing from all-time minutes.
        if (Id("Guitar") is int guitar)
        {
            goals.Add(new Goal
            {
                Name = "100h Guitar",
                TargetMinutes = 6000,
                ColorHex = "#2fe6d6",
                StartDate = today.AddDays(-45),
                Sources = new() { new GoalSource { HabitId = guitar } },
            });
        }

        // Composite goal: same structure, three feeders, counted all-time.
        var frontmanFeeders = new[] { "Singing", "Guitar", "Writing" }
            .Select(Id).Where(x => x is not null).Select(x => new GoalSource { HabitId = x!.Value }).ToList();
        if (frontmanFeeders.Count > 0)
        {
            goals.Add(new Goal
            {
                Name = "Frontman \u00B7 1000h", // · = middot; escaped so source encoding can't mojibake it
                TargetMinutes = 60000,
                ColorHex = "#ff3d8b",
                Sources = frontmanFeeders,
            });
        }

        if (goals.Count == 0) return;
        db.Goals.AddRange(goals);
        await db.SaveChangesAsync();
    }

    /// <summary>
    /// Seeds the recurring weekly schedule from the bundled timetable markdown.
    /// No-op if blocks already exist.
    /// </summary>
    public static async Task SeedScheduleAsync(AppDbContext db)
    {
        if (await db.ScheduleBlocks.AnyAsync()) return;

        var path = Path.Combine(AppContext.BaseDirectory, "SeedData", "weekly_timetable.md");
        if (!File.Exists(path)) return;

        var blocks = ScheduleParser.Parse(await File.ReadAllTextAsync(path));
        if (blocks.Count == 0) return;

        db.ScheduleBlocks.AddRange(blocks);
        await db.SaveChangesAsync();
    }

    private static MetricSample Sample(int sourceId, string key, DateTime at, double value, string unit) => new()
    {
        DataSourceId = sourceId,
        MetricKey = key,
        RecordedAt = new DateTimeOffset(at, TimeSpan.Zero),
        Value = value,
        Unit = unit,
    };
}
