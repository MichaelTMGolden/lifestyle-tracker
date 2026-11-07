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

public record ReviewGenerateInput(DateOnly? WeekStart);

// The weekly review.
public static partial class ApiEndpoints
{
    // Shape a stored review into the API response, re-parsing the JSON snapshots
    // so the client gets structured digest + output (every claim traceable to a fact).
    private static object ReviewDto(Domain.WeeklyReview r) => new
    {
        weekStart = r.WeekStart,
        status = r.Status,
        model = r.Model,
        createdAt = r.CreatedAt,
        narrative = r.Narrative,
        output = ParseJson(r.OutputJson),
        digest = ParseJson(r.DigestJson),
    };
    private static System.Text.Json.JsonElement? ParseJson(string json)
    {
        try { return System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement>(json); }
        catch { return null; }
    }

    internal static async Task<object> LatestReviewAsync(AppDbContext db, ReviewSynthesisService reviews)
    {
        var r = await db.WeeklyReviews.AsNoTracking().OrderByDescending(x => x.WeekStart).FirstOrDefaultAsync();
        return new { enabled = reviews.IsEnabled, review = r is null ? null : ReviewDto(r) };
    }

    private static void MapReviews(RouteGroupBuilder api)
    {
        // --- Weekly review (LLM synthesis over the deterministic digest) ---
        api.MapGet("/reviews/digest", async (AppDbContext db, HttpRequest req) =>
        {
            var clock = ClientClock.From(req);
            return Results.Ok(await WeeklyDigestService.BuildAsync(db, WeekStartOf(clock.Today), clock.Today));
        });
        // Refresh alerts first so the digest reflects current conditions, then build + synthesise.
        api.MapPost("/review/generate", async (ReviewGenerateInput? body, AppDbContext db, ReviewSynthesisService reviews, AlertService alerts, HttpRequest req) =>
        {
            if (!reviews.IsEnabled)
                return Results.Json(new { error = "Add an Anthropic API key (Anthropic:ApiKey) to enable weekly reviews." }, statusCode: StatusCodes.Status400BadRequest);
            var clock = ClientClock.From(req);
            var weekStart = body?.WeekStart ?? WeekStartOf(clock.Today);
            await alerts.GenerateIfStaleAsync(db, clock);
            var review = await reviews.GenerateForWeekAsync(db, weekStart, clock.Today);
            return Results.Ok(ReviewDto(review));
        });

        api.MapGet("/review/latest", async (AppDbContext db, ReviewSynthesisService reviews) => Results.Ok(await LatestReviewAsync(db, reviews)));

        api.MapGet("/review", async (string week, AppDbContext db) =>
        {
            if (!DateOnly.TryParse(week, out var ws)) return Results.BadRequest(new { error = "week must be YYYY-MM-DD" });
            var r = await db.WeeklyReviews.AsNoTracking().FirstOrDefaultAsync(x => x.WeekStart == ws);
            return r is null ? Results.NotFound() : Results.Ok(ReviewDto(r));
        });

        api.MapGet("/reviews", async (AppDbContext db) =>
            await db.WeeklyReviews.AsNoTracking()
                .OrderByDescending(x => x.WeekStart)
                .Select(x => new { weekStart = x.WeekStart, x.Status, x.CreatedAt })
                .ToListAsync());
    }
}
