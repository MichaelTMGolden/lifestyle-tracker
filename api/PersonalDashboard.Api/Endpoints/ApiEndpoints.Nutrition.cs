using System.Net.Http.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.EntityFrameworkCore;
using PersonalDashboard.Api;
using PersonalDashboard.Api.Data;
using PersonalDashboard.Api.Domain;
using PersonalDashboard.Api.Alerts;
using PersonalDashboard.Api.Challenges;
using PersonalDashboard.Api.Garmin;
using PersonalDashboard.Api.Goals;
using PersonalDashboard.Api.Health;
using PersonalDashboard.Api.Integrations;
using PersonalDashboard.Api.Nutrition;
using PersonalDashboard.Api.Reviews;
using PersonalDashboard.Api.Schedule;

namespace PersonalDashboard.Api.Endpoints;

public record SavedFoodLogInput(DateOnly? Date, MealType? Meal, double? Quantity);
public record QuickMealItemInput(
    string Name, string? Brand, int? DataSourceId, string? ExternalRef, string? ServingDescription,
    double Quantity, double? Grams, double Calories, double ProteinG, double CarbsG, double FatG,
    double FiberG = 0, double SugarG = 0, double SatFatG = 0,
    double SodiumMg = 0, double PotassiumMg = 0, double CalciumMg = 0, double IronMg = 0);
public record QuickMealInput(string Name, MealType? DefaultMeal, List<QuickMealItemInput>? Items);
public record QuickMealFromLogInput(string Name, DateOnly Date, MealType Meal);
public record QuickMealLogInput(DateOnly? Date, MealType? Meal);

public record FoodEntryInput(
    DateOnly? Date, MealType? Meal, string Name, string? Brand, string Source, string? ExternalRef,
    string? ServingDescription, double Quantity, double? Grams,
    double Calories, double ProteinG, double CarbsG, double FatG,
    double FiberG = 0, double SugarG = 0, double SatFatG = 0,
    double SodiumMg = 0, double PotassiumMg = 0, double CalciumMg = 0, double IronMg = 0);

// Food search, logging, saved foods and quick meals.
public static partial class ApiEndpoints
{
    private static SourceKind ParseFoodSource(string? source) => source switch
    {
        "OpenFoodFacts" => SourceKind.OpenFoodFacts,
        "Usda" or "USDA" => SourceKind.Usda,
        _ => SourceKind.Manual,
    };

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

    /// <summary>Build a FoodEntry from any macro snapshot, scaling the as-eaten macros by <paramref name="scale"/>.</summary>
    private static FoodEntry ScaledEntry(IFoodMacros m, int dataSourceId, DateOnly date, MealType meal, double quantity, double? grams, double scale)
    {
        static double R1(double v) => Math.Round(v, 1);
        return new FoodEntry
        {
            DataSourceId = dataSourceId, Date = date, LoggedAt = DateTimeOffset.UtcNow, Meal = meal,
            Name = m.Name, Brand = m.Brand, ExternalRef = m.ExternalRef, ServingDescription = m.ServingDescription,
            Quantity = quantity, Grams = grams,
            Calories = Math.Round(m.Calories * scale), ProteinG = R1(m.ProteinG * scale), CarbsG = R1(m.CarbsG * scale), FatG = R1(m.FatG * scale),
            FiberG = R1(m.FiberG * scale), SugarG = R1(m.SugarG * scale), SatFatG = R1(m.SatFatG * scale),
            SodiumMg = Math.Round(m.SodiumMg * scale), PotassiumMg = Math.Round(m.PotassiumMg * scale),
            CalciumMg = Math.Round(m.CalciumMg * scale), IronMg = R1(m.IronMg * scale),
        };
    }

    /// <summary>
    /// Auto-remember a logged food: upsert its SavedFood by (Name, Brand, ExternalRef),
    /// refresh the stored snapshot (last-logged wins), bump UseCount + LastUsedAt.
    /// </summary>
    private static async Task RememberFoodAsync(AppDbContext db, FoodEntry e)
    {
        var sf = await db.SavedFoods.FirstOrDefaultAsync(f => f.Name == e.Name && f.Brand == e.Brand && f.ExternalRef == e.ExternalRef);
        if (sf is null) { sf = new SavedFood { Name = e.Name }; db.SavedFoods.Add(sf); }
        sf.Brand = e.Brand; sf.ExternalRef = e.ExternalRef; sf.DataSourceId = e.DataSourceId;
        sf.ServingDescription = e.ServingDescription; sf.DefaultQuantity = e.Quantity; sf.Grams = e.Grams;
        sf.Calories = e.Calories; sf.ProteinG = e.ProteinG; sf.CarbsG = e.CarbsG; sf.FatG = e.FatG;
        sf.FiberG = e.FiberG; sf.SugarG = e.SugarG; sf.SatFatG = e.SatFatG;
        sf.SodiumMg = e.SodiumMg; sf.PotassiumMg = e.PotassiumMg; sf.CalciumMg = e.CalciumMg; sf.IronMg = e.IronMg;
        sf.UseCount += 1; sf.LastUsedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync();
    }

    private static QuickMealItem ItemFromInput(QuickMealItemInput i) => new()
    {
        Name = i.Name.Trim(), Brand = i.Brand, DataSourceId = i.DataSourceId, ExternalRef = i.ExternalRef,
        ServingDescription = i.ServingDescription, Quantity = i.Quantity <= 0 ? 1 : i.Quantity, Grams = i.Grams,
        Calories = i.Calories, ProteinG = i.ProteinG, CarbsG = i.CarbsG, FatG = i.FatG,
        FiberG = i.FiberG, SugarG = i.SugarG, SatFatG = i.SatFatG,
        SodiumMg = i.SodiumMg, PotassiumMg = i.PotassiumMg, CalciumMg = i.CalciumMg, IronMg = i.IronMg,
    };

    private static QuickMealItem ItemFromEntry(FoodEntry e) => new()
    {
        Name = e.Name, Brand = e.Brand, DataSourceId = e.DataSourceId, ExternalRef = e.ExternalRef,
        ServingDescription = e.ServingDescription, Quantity = e.Quantity, Grams = e.Grams,
        Calories = e.Calories, ProteinG = e.ProteinG, CarbsG = e.CarbsG, FatG = e.FatG,
        FiberG = e.FiberG, SugarG = e.SugarG, SatFatG = e.SatFatG,
        SodiumMg = e.SodiumMg, PotassiumMg = e.PotassiumMg, CalciumMg = e.CalciumMg, IronMg = e.IronMg,
    };

    private static void MapNutrition(RouteGroupBuilder api)
    {
        // --- Food search (server-side proxy over Open Food Facts + USDA) ---
        api.MapGet("/food/search", async (FoodSearchService svc, string? q, string? country, CancellationToken ct) =>
            Results.Ok(await svc.SearchAsync(q ?? "", country ?? "ie", ct)));

        // --- Nutrition: per-food logging + materialized daily rollup ---
        api.MapGet("/nutrition/day", async (AppDbContext db, HttpRequest req, string? date) =>
        {
            var clock = ClientClock.From(req);
            var d = date is not null && DateOnly.TryParse(date, out var pd) ? pd : clock.Today;
            var settings = await db.DashboardSettings.AsNoTracking().FirstOrDefaultAsync() ?? new DashboardSettings();
            // These are daily samples keyed by the source's calendar date (Garmin stamps noon UTC).
            var dayStart = new DateTimeOffset(d.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);
            var activeCandidates = await db.MetricSamples.AsNoTracking()
                .Where(m => m.MetricKey == "active_calories" && m.RecordedAt >= dayStart && m.RecordedAt < dayStart.AddDays(1))
                .Select(m => new { m.Id, m.RecordedAt, m.Value, SourceName = m.DataSource!.Name }).ToListAsync();
            var activeCalories = activeCandidates
                .Where(m => double.IsFinite(m.Value) && m.Value >= 0 &&
                    !(m.SourceName ?? "").Contains("(sample)", StringComparison.OrdinalIgnoreCase))
                .OrderByDescending(m => m.RecordedAt).ThenByDescending(m => m.Id)
                .Select(m => (double?)m.Value).FirstOrDefault();
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
                activeCalories,
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
                targets = new { proteinG = settings.ProteinGTarget, calories = settings.CaloriesTarget,
                    carbsG = settings.CarbsGTarget, fatG = settings.FatGTarget, restingCaloriesEstimate = settings.RestingCaloriesEstimate },
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
            await RememberFoodAsync(db, entry); // recents/frequents populate with no explicit save
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

        // --- Remembered foods (recents / frequents / favorites) ---
        api.MapGet("/foods/remembered", async (AppDbContext db, string? tab, string? q) =>
        {
            var query = db.SavedFoods.AsNoTracking().AsQueryable();
            if (tab == "favorite") query = query.Where(f => f.Favorite);
            if (!string.IsNullOrWhiteSpace(q))
            {
                var qq = q.Trim().ToLower();
                query = query.Where(f => f.Name.ToLower().Contains(qq) || (f.Brand != null && f.Brand.ToLower().Contains(qq)));
            }
            query = tab == "frequent"
                ? query.OrderByDescending(f => f.UseCount).ThenByDescending(f => f.LastUsedAt)
                : query.OrderByDescending(f => f.LastUsedAt).ThenByDescending(f => f.UseCount);
            return await query.Take(40).ToListAsync();
        });

        api.MapPost("/foods/{id:int}/log", async (int id, SavedFoodLogInput body, AppDbContext db, HttpRequest req) =>
        {
            var sf = await db.SavedFoods.FindAsync(id);
            if (sf is null) return Results.NotFound();
            var date = body.Date ?? ClientClock.From(req).Today;
            var reqQty = body.Quantity is double q && q > 0 ? q : sf.DefaultQuantity;
            var scale = sf.DefaultQuantity > 0 ? reqQty / sf.DefaultQuantity : 1;
            var dataSourceId = sf.DataSourceId ?? (await GetFoodSourceAsync(db, SourceKind.Manual)).Id;
            var entry = ScaledEntry(sf, dataSourceId, date, body.Meal ?? MealType.Other, reqQty, sf.Grams, scale);
            db.FoodEntries.Add(entry);
            sf.UseCount += 1; sf.LastUsedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync();
            await RecomputeDayRollupAsync(db, date);
            return Results.Created($"/api/nutrition/entries/{entry.Id}", entry);
        });

        api.MapPost("/foods/{id:int}/favorite", async (int id, AppDbContext db) =>
        {
            var sf = await db.SavedFoods.FindAsync(id);
            if (sf is null) return Results.NotFound();
            sf.Favorite = !sf.Favorite;
            await db.SaveChangesAsync();
            return Results.Ok(new { sf.Id, sf.Favorite });
        });

        api.MapDelete("/foods/{id:int}", async (int id, AppDbContext db) =>
        {
            var sf = await db.SavedFoods.FindAsync(id);
            if (sf is null) return Results.NotFound();
            db.SavedFoods.Remove(sf);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // --- Quick meals (reusable bundles) ---
        api.MapGet("/quick-meals", async (AppDbContext db) =>
        {
            var meals = await db.QuickMeals.AsNoTracking().Include(m => m.Items)
                .OrderByDescending(m => m.LastUsedAt).ThenBy(m => m.Name).ToListAsync();
            return meals.Select(m => new
            {
                m.Id, m.Name, m.DefaultMeal, m.UseCount, m.LastUsedAt,
                itemCount = m.Items.Count,
                totalCalories = Math.Round(m.Items.Sum(i => i.Calories)),
                totalProteinG = Math.Round(m.Items.Sum(i => i.ProteinG), 1),
                totalCarbsG = Math.Round(m.Items.Sum(i => i.CarbsG), 1),
                totalFatG = Math.Round(m.Items.Sum(i => i.FatG), 1),
            });
        });

        api.MapGet("/quick-meals/{id:int}", async (int id, AppDbContext db) =>
        {
            var m = await db.QuickMeals.AsNoTracking().Include(x => x.Items).FirstOrDefaultAsync(x => x.Id == id);
            if (m is null) return Results.NotFound();
            return Results.Ok(new
            {
                m.Id, m.Name, m.DefaultMeal, m.UseCount, m.LastUsedAt,
                items = m.Items.OrderBy(i => i.Id).Select(i => new
                {
                    i.Id, i.Name, i.Brand, i.DataSourceId, i.ExternalRef, i.ServingDescription, i.Quantity, i.Grams,
                    i.Calories, i.ProteinG, i.CarbsG, i.FatG,
                    i.FiberG, i.SugarG, i.SatFatG, i.SodiumMg, i.PotassiumMg, i.CalciumMg, i.IronMg,
                }),
            });
        });

        api.MapPost("/quick-meals", async (QuickMealInput input, AppDbContext db) =>
        {
            if (string.IsNullOrWhiteSpace(input.Name)) return Results.BadRequest(new { error = "Name required" });
            var meal = new QuickMeal { Name = input.Name.Trim(), DefaultMeal = input.DefaultMeal };
            foreach (var i in input.Items ?? new()) meal.Items.Add(ItemFromInput(i));
            db.QuickMeals.Add(meal);
            await db.SaveChangesAsync();
            return Results.Created($"/api/quick-meals/{meal.Id}", new { meal.Id });
        });

        api.MapPost("/quick-meals/from-log", async (QuickMealFromLogInput input, AppDbContext db) =>
        {
            if (string.IsNullOrWhiteSpace(input.Name)) return Results.BadRequest(new { error = "Name required" });
            var entries = await db.FoodEntries.Where(e => e.Date == input.Date && e.Meal == input.Meal).ToListAsync();
            if (entries.Count == 0) return Results.BadRequest(new { error = "No foods logged in that meal" });
            var meal = new QuickMeal { Name = input.Name.Trim(), DefaultMeal = input.Meal };
            foreach (var e in entries) meal.Items.Add(ItemFromEntry(e));
            db.QuickMeals.Add(meal);
            await db.SaveChangesAsync();
            return Results.Created($"/api/quick-meals/{meal.Id}", new { meal.Id });
        });

        api.MapPut("/quick-meals/{id:int}", async (int id, QuickMealInput input, AppDbContext db) =>
        {
            var meal = await db.QuickMeals.Include(m => m.Items).FirstOrDefaultAsync(m => m.Id == id);
            if (meal is null) return Results.NotFound();
            if (!string.IsNullOrWhiteSpace(input.Name)) meal.Name = input.Name.Trim();
            meal.DefaultMeal = input.DefaultMeal;
            if (input.Items is not null)
            {
                db.QuickMealItems.RemoveRange(meal.Items);
                meal.Items = input.Items.Select(ItemFromInput).ToList();
            }
            await db.SaveChangesAsync();
            return Results.Ok(new { meal.Id });
        });

        api.MapDelete("/quick-meals/{id:int}", async (int id, AppDbContext db) =>
        {
            var meal = await db.QuickMeals.FindAsync(id);
            if (meal is null) return Results.NotFound();
            db.QuickMeals.Remove(meal);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        api.MapPost("/quick-meals/{id:int}/log", async (int id, QuickMealLogInput body, AppDbContext db, HttpRequest req) =>
        {
            var meal = await db.QuickMeals.Include(m => m.Items).FirstOrDefaultAsync(m => m.Id == id);
            if (meal is null) return Results.NotFound();
            var date = body.Date ?? ClientClock.From(req).Today;
            var slot = body.Meal ?? meal.DefaultMeal ?? MealType.Other;
            var manualId = (await GetFoodSourceAsync(db, SourceKind.Manual)).Id;
            foreach (var i in meal.Items)
                db.FoodEntries.Add(ScaledEntry(i, i.DataSourceId ?? manualId, date, slot, i.Quantity, i.Grams, 1));
            meal.UseCount += 1; meal.LastUsedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync();
            await RecomputeDayRollupAsync(db, date); // recompute once after all inserts
            return Results.Ok(new { logged = meal.Items.Count, date = date.ToString("yyyy-MM-dd") });
        });
    }
}
