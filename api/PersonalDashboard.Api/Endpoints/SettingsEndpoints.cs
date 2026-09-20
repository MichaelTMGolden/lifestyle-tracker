using Microsoft.EntityFrameworkCore;
using PersonalDashboard.Api.Data;
using PersonalDashboard.Api.Domain;

namespace PersonalDashboard.Api.Endpoints;

public static class SettingsEndpoints
{
    public static void MapSettingsEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/settings", async (AppDbContext db) =>
            Results.Ok(await db.DashboardSettings.AsNoTracking().SingleOrDefaultAsync(s => s.Id == 1) ?? new DashboardSettings()));

        app.MapPut("/api/settings", async (DashboardSettings input, AppDbContext db) =>
        {
            var error = Validate(input);
            if (error is not null) return Results.BadRequest(new { error });
            input.Id = 1;
            var existing = await db.DashboardSettings.SingleOrDefaultAsync(s => s.Id == 1);
            if (existing is null) db.DashboardSettings.Add(input);
            else db.Entry(existing).CurrentValues.SetValues(input);
            await db.SaveChangesAsync();
            return Results.Ok(input);
        });
    }

    public static string? Validate(DashboardSettings s)
    {
        if (s.CaloriesTarget is < 500 or > 10000) return "Calorie target must be between 500 and 10,000 kcal.";
        if (s.ProteinGTarget is < 1 or > 1000 || s.CarbsGTarget is < 1 or > 1500 || s.FatGTarget is < 1 or > 1000)
            return "Enter positive macro targets within the displayed limits.";
        if (s.StepsTarget is < 100 or > 100000) return "Step target must be between 100 and 100,000.";
        if (s.SleepMinutesTarget is < 60 or > 960) return "Sleep target must be between 60 and 960 minutes.";
        if (s.SleepScoreTarget is < 1 or > 100) return "Sleep score target must be between 1 and 100.";
        if (s.RestingHrBaseline is < 20 or > 150) return "Resting heart rate baseline must be between 20 and 150 bpm.";
        if (s.RestingCaloriesEstimate is < 500 or > 5000) return "Resting calorie estimate must be between 500 and 5,000 kcal.";
        if (s.ArtistMonthlyListenersTarget < 0 || s.ArtistFollowersTarget < 0 || s.ArtistTotalStreamsTarget < 0)
            return "Artist targets cannot be negative; use zero for no target.";
        return null;
    }
}
