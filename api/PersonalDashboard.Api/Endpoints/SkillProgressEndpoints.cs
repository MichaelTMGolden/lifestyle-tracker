using Microsoft.EntityFrameworkCore;
using PersonalDashboard.Api.Data;
using PersonalDashboard.Api.Domain;

namespace PersonalDashboard.Api.Endpoints;

public record SkillBenchmarkInput(int HabitId, string Name, string Rubric);
public record SkillAssessmentInput(DateOnly AssessedOn, double Score, string? EvidenceUrl, string? Notes);
public record HabitCadenceInput(string Cadence, int TargetPerPeriod);

public static class SkillProgressEndpoints
{
    public static void MapSkillProgressEndpoints(this WebApplication app)
    {
        var api = app.MapGroup("/api");
        api.MapGet("/skill-benchmarks", async (AppDbContext db) => Results.Ok(await db.SkillBenchmarks
            .OrderBy(b => b.Id).Select(b => new
            {
                b.Id, b.HabitId, habitName = b.Habit!.Name, b.Name, b.Rubric, b.Archived,
                assessments = b.Assessments.OrderByDescending(a => a.AssessedOn)
                    .Select(a => new { a.Id, a.AssessedOn, a.Score, a.EvidenceUrl, a.Notes }).ToList(),
            }).ToListAsync()));

        api.MapPost("/skill-benchmarks", async (SkillBenchmarkInput input, AppDbContext db) =>
        {
            if (string.IsNullOrWhiteSpace(input.Name) || input.Name.Length > 120 ||
                string.IsNullOrWhiteSpace(input.Rubric) || input.Rubric.Length > 3000)
                return Results.BadRequest(new { error = "Add a benchmark name (up to 120 characters) and a scoring rubric (up to 3,000 characters)." });
            if (!await db.Habits.AnyAsync(h => h.Id == input.HabitId && !h.Archived))
                return Results.BadRequest(new { error = "Choose an existing skill." });
            var benchmark = new SkillBenchmark { HabitId = input.HabitId, Name = input.Name.Trim(), Rubric = input.Rubric.Trim() };
            db.SkillBenchmarks.Add(benchmark);
            await db.SaveChangesAsync();
            return Results.Created($"/api/skill-benchmarks/{benchmark.Id}", new { benchmark.Id });
        });

        api.MapPut("/skill-benchmarks/{id:int}/archived", async (int id, ArchiveSkillInput input, AppDbContext db) =>
        {
            var benchmark = await db.SkillBenchmarks.FindAsync(id);
            if (benchmark is null) return Results.NotFound();
            benchmark.Archived = input.Archived;
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // The date identifies a checkpoint; re-saving corrects it without adding a second score.
        api.MapPut("/skill-benchmarks/{id:int}/assessments", async (int id, SkillAssessmentInput input, AppDbContext db, HttpRequest req) =>
        {
            var error = ValidateAssessment(input, ClientClock.From(req).Today);
            if (error is not null) return Results.BadRequest(new { error });
            var benchmark = await db.SkillBenchmarks.FindAsync(id);
            if (benchmark is null) return Results.NotFound();
            if (benchmark.Archived) return Results.BadRequest(new { error = "Restore this benchmark before recording an assessment." });
            var assessment = await db.SkillAssessments.FirstOrDefaultAsync(a => a.SkillBenchmarkId == id && a.AssessedOn == input.AssessedOn);
            if (assessment is null)
            {
                assessment = new SkillAssessment { SkillBenchmarkId = id, AssessedOn = input.AssessedOn };
                db.SkillAssessments.Add(assessment);
            }
            assessment.Score = input.Score;
            assessment.EvidenceUrl = TrimOrNull(input.EvidenceUrl);
            assessment.Notes = TrimOrNull(input.Notes);
            await db.SaveChangesAsync();
            return Results.Ok(new { assessment.Id });
        });

        api.MapDelete("/skill-assessments/{id:long}", async (long id, AppDbContext db) =>
        {
            var assessment = await db.SkillAssessments.FindAsync(id);
            if (assessment is null) return Results.NotFound();
            db.SkillAssessments.Remove(assessment);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        api.MapPut("/habits/{id:int}/cadence", async (int id, HabitCadenceInput input, AppDbContext db) =>
        {
            if (!HabitCadencePolicy.IsValid(input.Cadence, input.TargetPerPeriod))
                return Results.BadRequest(new { error = "Choose daily (once a day) or weekly (1–7 practice days)." });
            var habit = await db.Habits.FindAsync(id);
            if (habit is null) return Results.NotFound();
            habit.Cadence = input.Cadence;
            habit.TargetPerPeriod = input.TargetPerPeriod;
            await db.SaveChangesAsync();
            return Results.NoContent();
        });
    }

    public static string? ValidateAssessment(SkillAssessmentInput input, DateOnly today)
    {
        if (input.AssessedOn == default || input.AssessedOn > today) return "Choose a date on or before today.";
        if (!double.IsFinite(input.Score) || input.Score < 0 || input.Score > 10) return "Score must be between 0 and 10.";
        if (string.IsNullOrWhiteSpace(input.EvidenceUrl) && string.IsNullOrWhiteSpace(input.Notes))
            return "Add a recording link or notes explaining the score.";
        if (input.Notes?.Length > 5000 || input.EvidenceUrl?.Length > 2000) return "Keep notes within 5,000 characters and links within 2,000 characters.";
        if (!string.IsNullOrWhiteSpace(input.EvidenceUrl) &&
            (!Uri.TryCreate(input.EvidenceUrl.Trim(), UriKind.Absolute, out var uri) || uri.Scheme is not ("https" or "http")))
            return "Evidence links must start with https:// or http://.";
        return null;
    }

    private static string? TrimOrNull(string? text) => string.IsNullOrWhiteSpace(text) ? null : text.Trim();
}

public record ArchiveSkillInput(bool Archived);

/// <summary>Weekly practice is measured in active days; unplanned rest days never break a week streak.</summary>
public static class HabitCadencePolicy
{
    public static bool IsValid(string cadence, int target) => cadence == "daily" ? target == 1 : cadence == "weekly" && target is >= 1 and <= 7;
    public static DateOnly WeekStart(DateOnly date) => date.AddDays(-(((int)date.DayOfWeek + 6) % 7));
    public static int Streak(IEnumerable<DateOnly> dates, DateOnly today, string cadence, int target)
    {
        var complete = dates.Where(d => d <= today).ToHashSet();
        var weekly = cadence == "weekly";
        var length = weekly ? 7 : 1;
        var cursor = weekly ? WeekStart(today) : today;
        bool Met(DateOnly start) => complete.Count(d => d >= start && d < start.AddDays(length)) >= (weekly ? Math.Clamp(target, 1, 7) : 1);
        if (!Met(cursor)) cursor = cursor.AddDays(-length); // current period is still in progress
        var streak = 0;
        while (Met(cursor)) { streak++; cursor = cursor.AddDays(-length); }
        return streak;
    }
}
