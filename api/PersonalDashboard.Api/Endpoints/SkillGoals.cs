using Microsoft.EntityFrameworkCore;
using PersonalDashboard.Api.Data;
using PersonalDashboard.Api.Domain;

namespace PersonalDashboard.Api.Endpoints;

public record SkillGoalInput(int HabitId, string? Title, string? Note, List<string>? Steps);
public record SkillGoalEdit(string? Title, string? Note);
public record SkillGoalDone(bool Done);
public record SkillGoalStepInput(string? Title);
public record SkillGoalStepEdit(string? Title, bool? Done);

/// <summary>
/// Goals to work toward on a skill, with no deadline ("learn the solo"), each
/// with optional steps. Every write returns the goal as it now stands.
/// </summary>
public static class SkillGoals
{
    public const int MaxTitle = 120;
    public const int MaxNote = 500;
    public const int MaxSteps = 30;
    /// <summary>Open goals per skill: enough for anything real, and a bound on the list.</summary>
    public const int MaxOpen = 20;

    public record StepRow(int Id, string Title, DateOnly? DoneOn);
    public record GoalRow(int Id, int HabitId, string Title, string? Note, DateOnly CreatedOn, DateOnly? DoneOn, List<StepRow> Steps);

    public static GoalRow Row(SkillGoal g) => new(g.Id, g.HabitId, g.Title, g.Note, g.CreatedOn, g.DoneOn,
        g.Steps.OrderBy(s => s.Position).ThenBy(s => s.Id).Select(s => new StepRow(s.Id, s.Title, s.DoneOn)).ToList());

    /// <summary>A trimmed title, or an error message.</summary>
    static (string? Value, string? Error) Title(string? raw, string what)
    {
        var t = raw?.Trim();
        if (string.IsNullOrEmpty(t)) return (null, $"{what} needs a name");
        if (t.Length > MaxTitle) return (null, $"{what} must be {MaxTitle} characters or fewer");
        return (t, null);
    }

    static (string? Value, string? Error) Note(string? raw)
    {
        var n = string.IsNullOrWhiteSpace(raw) ? null : raw.Trim();
        return n is { Length: > MaxNote } ? (null, $"the note must be {MaxNote} characters or fewer") : (n, null);
    }

    public static async Task<(GoalRow? Goal, string? Error)> CreateAsync(AppDbContext db, SkillGoalInput input, DateOnly today)
    {
        var (title, error) = Title(input.Title, "the goal");
        if (error is not null) return (null, error);
        var (note, noteError) = Note(input.Note);
        if (noteError is not null) return (null, noteError);
        var steps = (input.Steps ?? new()).Where(s => !string.IsNullOrWhiteSpace(s)).Select(s => s.Trim()).ToList();
        if (steps.Count > MaxSteps) return (null, $"a goal can have up to {MaxSteps} steps");
        if (steps.FirstOrDefault(s => s.Length > MaxTitle) is not null) return (null, $"each step must be {MaxTitle} characters or fewer");
        if (!await db.Habits.AnyAsync(h => h.Id == input.HabitId && !h.Archived)) return (null, "that habit no longer exists");
        if (await db.SkillGoals.CountAsync(g => g.HabitId == input.HabitId && g.DoneOn == null) >= MaxOpen)
            return (null, $"a habit can have up to {MaxOpen} open goals; mark one reached or delete one first");

        var goal = new SkillGoal
        {
            HabitId = input.HabitId, Title = title!, Note = note, CreatedOn = today,
            Steps = steps.Select((s, i) => new SkillGoalStep { Title = s, Position = i }).ToList(),
        };
        db.SkillGoals.Add(goal);
        await db.SaveChangesAsync();
        return (Row(goal), null);
    }

    static Task<SkillGoal?> LoadAsync(AppDbContext db, int id) =>
        db.SkillGoals.Include(g => g.Steps).FirstOrDefaultAsync(g => g.Id == id);

    public static async Task<(GoalRow? Goal, string? Error)> EditAsync(AppDbContext db, int id, SkillGoalEdit input)
    {
        var (title, error) = Title(input.Title, "the goal");
        if (error is not null) return (null, error);
        var (note, noteError) = Note(input.Note);
        if (noteError is not null) return (null, noteError);
        if (await LoadAsync(db, id) is not { } goal) return (null, null);
        goal.Title = title!; goal.Note = note;
        await db.SaveChangesAsync();
        return (Row(goal), null);
    }

    /// <summary>Marks the goal reached today, or open again. Repeating either is a no-op.</summary>
    public static async Task<GoalRow?> SetDoneAsync(AppDbContext db, int id, bool done, DateOnly today)
    {
        if (await LoadAsync(db, id) is not { } goal) return null;
        if (done) goal.DoneOn ??= today; else goal.DoneOn = null;
        await db.SaveChangesAsync();
        return Row(goal);
    }

    public static async Task<(GoalRow? Goal, string? Error)> AddStepAsync(AppDbContext db, int id, SkillGoalStepInput input)
    {
        var (title, error) = Title(input.Title, "the step");
        if (error is not null) return (null, error);
        if (await LoadAsync(db, id) is not { } goal) return (null, null);
        if (goal.Steps.Count >= MaxSteps) return (null, $"a goal can have up to {MaxSteps} steps");
        goal.Steps.Add(new SkillGoalStep { Title = title!, Position = goal.Steps.Count == 0 ? 0 : goal.Steps.Max(s => s.Position) + 1 });
        await db.SaveChangesAsync();
        return (Row(goal), null);
    }

    public static async Task<(GoalRow? Goal, string? Error)> EditStepAsync(AppDbContext db, int goalId, int stepId, SkillGoalStepEdit input, DateOnly today)
    {
        string? title = null;
        if (input.Title is not null)
        {
            var (t, error) = Title(input.Title, "the step");
            if (error is not null) return (null, error);
            title = t;
        }
        if (await LoadAsync(db, goalId) is not { } goal) return (null, null);
        if (goal.Steps.FirstOrDefault(s => s.Id == stepId) is not { } step) return (null, null);
        if (title is not null) step.Title = title;
        if (input.Done is bool done) { if (done) step.DoneOn ??= today; else step.DoneOn = null; }
        await db.SaveChangesAsync();
        return (Row(goal), null);
    }

    public static async Task<GoalRow?> RemoveStepAsync(AppDbContext db, int goalId, int stepId)
    {
        if (await LoadAsync(db, goalId) is not { } goal) return null;
        if (goal.Steps.FirstOrDefault(s => s.Id == stepId) is not { } step) return null;
        goal.Steps.Remove(step);
        db.SkillGoalSteps.Remove(step);
        await db.SaveChangesAsync();
        return Row(goal);
    }

    static IResult Reply((GoalRow? Goal, string? Error) r) =>
        r.Error is not null ? Results.BadRequest(new { message = r.Error })
        : r.Goal is null ? Results.NotFound() : Results.Ok(r.Goal);

    internal static void Map(RouteGroupBuilder api)
    {
        // Every goal, open and reached (a handful per habit; the app sorts and filters).
        api.MapGet("/skill-goals", async (AppDbContext db) =>
            (await db.SkillGoals.AsNoTracking().Include(g => g.Steps).OrderBy(g => g.Id).ToListAsync()).Select(Row));

        api.MapPost("/skill-goals", async (SkillGoalInput body, AppDbContext db, HttpRequest req) =>
        {
            var r = await CreateAsync(db, body, ClientClock.From(req).Today);
            return r.Error is not null ? Results.BadRequest(new { message = r.Error }) : Results.Created($"/api/skill-goals/{r.Goal!.Id}", r.Goal);
        });

        api.MapPut("/skill-goals/{id:int}", async (int id, SkillGoalEdit body, AppDbContext db) => Reply(await EditAsync(db, id, body)));

        api.MapPut("/skill-goals/{id:int}/done", async (int id, SkillGoalDone body, AppDbContext db, HttpRequest req) =>
            await SetDoneAsync(db, id, body.Done, ClientClock.From(req).Today) is { } g ? Results.Ok(g) : Results.NotFound());

        api.MapDelete("/skill-goals/{id:int}", async (int id, AppDbContext db) =>
        {
            if (await db.SkillGoals.FindAsync(id) is not { } goal) return Results.NotFound();
            db.SkillGoals.Remove(goal);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        api.MapPost("/skill-goals/{id:int}/steps", async (int id, SkillGoalStepInput body, AppDbContext db) => Reply(await AddStepAsync(db, id, body)));

        api.MapPut("/skill-goals/{id:int}/steps/{stepId:int}", async (int id, int stepId, SkillGoalStepEdit body, AppDbContext db, HttpRequest req) =>
            Reply(await EditStepAsync(db, id, stepId, body, ClientClock.From(req).Today)));

        api.MapDelete("/skill-goals/{id:int}/steps/{stepId:int}", async (int id, int stepId, AppDbContext db) =>
            await RemoveStepAsync(db, id, stepId) is { } g ? Results.Ok(g) : Results.NotFound());
    }
}
