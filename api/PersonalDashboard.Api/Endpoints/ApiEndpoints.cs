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

public record LoginInput(string Password);

public static partial class ApiEndpoints
{
    private static async Task<DataSource> GetOrCreateSourceAsync(AppDbContext db, SourceKind kind, string name)
    {
        var src = await db.DataSources.FirstOrDefaultAsync(s => s.Kind == kind && s.Name == name);
        if (src is null) { src = new DataSource { Name = name, Kind = kind }; db.DataSources.Add(src); await db.SaveChangesAsync(); }
        return src;
    }

    // --- secret store (Garmin credentials) ---
    private static async Task<string?> GetSecretAsync(AppDbContext db, string key) =>
        (await db.AppSecrets.AsNoTracking().FirstOrDefaultAsync(s => s.Key == key))?.Value;
    private static async Task SetSecretAsync(AppDbContext db, string key, string value)
    {
        var row = await db.AppSecrets.FirstOrDefaultAsync(s => s.Key == key);
        if (row is null) db.AppSecrets.Add(new AppSecret { Key = key, Value = value });
        else row.Value = value;
        await db.SaveChangesAsync();
    }
    private static async Task DeleteSecretAsync(AppDbContext db, string key) =>
        await db.AppSecrets.Where(s => s.Key == key).ExecuteDeleteAsync();

    /// <summary>Monday of the week containing <paramref name="d"/>.</summary>
    private static DateOnly WeekStartOf(DateOnly d) => d.AddDays(-(((int)d.DayOfWeek + 6) % 7));

    public static void MapApiEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api");
        api.MapDailyPlanningEndpoints();
        MapMetrics(api);
        MapSchedule(api);
        MapToday(api);
        MapConnections(api);
        MapArtist(api);
        MapHabits(api);
        MapGoals(api);
        MapAlerts(api);
        MapReviews(api);
        MapBingo(api);
        MapTodos(api);
        MapChallenges(api);
        MapNutrition(api);
        MapPush(api);
    }
}
