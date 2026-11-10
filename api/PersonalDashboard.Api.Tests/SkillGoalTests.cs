using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using PersonalDashboard.Api.Data;
using PersonalDashboard.Api.Domain;
using PersonalDashboard.Api.Endpoints;
using Xunit;

namespace PersonalDashboard.Api.Tests;

public class SkillGoalTests
{
    private static readonly DateOnly Today = new(2026, 11, 10);

    private static async Task<(AppDbContext Db, int HabitId)> Setup()
    {
        var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning)).Options);
        var h = new Habit { Name = "Guitar" };
        db.Habits.Add(h);
        await db.SaveChangesAsync();
        return (db, h.Id);
    }

    [Fact]
    public async Task A_goal_is_made_with_its_steps_in_order()
    {
        var (db, habit) = await Setup();
        var (g, error) = await SkillGoals.CreateAsync(db, new(habit, "  Learn the solo ", null, ["Intro", " ", "Bends", "Full speed"]), Today);
        Assert.Null(error);
        Assert.Equal("Learn the solo", g!.Title);
        Assert.Equal(Today, g.CreatedOn);
        Assert.Null(g.DoneOn);
        Assert.Equal(["Intro", "Bends", "Full speed"], g.Steps.Select(s => s.Title));
    }

    [Fact]
    public async Task Bad_input_is_refused()
    {
        var (db, habit) = await Setup();
        Assert.NotNull((await SkillGoals.CreateAsync(db, new(habit, " ", null, null), Today)).Error);
        Assert.NotNull((await SkillGoals.CreateAsync(db, new(habit, new string('x', 121), null, null), Today)).Error);
        Assert.NotNull((await SkillGoals.CreateAsync(db, new(habit, "ok", new string('x', 501), null), Today)).Error);
        Assert.NotNull((await SkillGoals.CreateAsync(db, new(habit, "ok", null, Enumerable.Repeat("s", 31).ToList()), Today)).Error);
        Assert.NotNull((await SkillGoals.CreateAsync(db, new(habit + 99, "ok", null, null), Today)).Error);
        Assert.False(await db.SkillGoals.AnyAsync());
    }

    [Fact]
    public async Task Open_goals_per_habit_are_capped_but_reached_ones_free_a_slot()
    {
        var (db, habit) = await Setup();
        for (var i = 0; i < SkillGoals.MaxOpen; i++) Assert.Null((await SkillGoals.CreateAsync(db, new(habit, $"G{i}", null, null), Today)).Error);
        Assert.NotNull((await SkillGoals.CreateAsync(db, new(habit, "one more", null, null), Today)).Error);
        await SkillGoals.SetDoneAsync(db, (await db.SkillGoals.FirstAsync()).Id, true, Today);
        Assert.Null((await SkillGoals.CreateAsync(db, new(habit, "one more", null, null), Today)).Error);
    }

    [Fact]
    public async Task Reaching_keeps_the_first_date_and_reopening_clears_it()
    {
        var (db, habit) = await Setup();
        var (g, _) = await SkillGoals.CreateAsync(db, new(habit, "Finish the song", null, null), Today);
        Assert.Equal(Today, (await SkillGoals.SetDoneAsync(db, g!.Id, true, Today))!.DoneOn);
        Assert.Equal(Today, (await SkillGoals.SetDoneAsync(db, g.Id, true, Today.AddDays(2)))!.DoneOn);
        Assert.Null((await SkillGoals.SetDoneAsync(db, g.Id, false, Today))!.DoneOn);
        Assert.Null(await SkillGoals.SetDoneAsync(db, 999, true, Today));
    }

    [Fact]
    public async Task Steps_are_added_ticked_renamed_and_removed()
    {
        var (db, habit) = await Setup();
        var (g, _) = await SkillGoals.CreateAsync(db, new(habit, "Learn the solo", null, ["Intro"]), Today);
        var (added, _) = await SkillGoals.AddStepAsync(db, g!.Id, new("Outro"));
        Assert.Equal(["Intro", "Outro"], added!.Steps.Select(s => s.Title));

        var outro = added.Steps[1].Id;
        var (ticked, _) = await SkillGoals.EditStepAsync(db, g.Id, outro, new(null, true), Today);
        Assert.Equal(Today, ticked!.Steps[1].DoneOn);
        var (renamed, _) = await SkillGoals.EditStepAsync(db, g.Id, outro, new("Outro at tempo", null), Today);
        Assert.Equal("Outro at tempo", renamed!.Steps[1].Title);
        Assert.Equal(Today, renamed.Steps[1].DoneOn);
        var (unticked, _) = await SkillGoals.EditStepAsync(db, g.Id, outro, new(null, false), Today);
        Assert.Null(unticked!.Steps[1].DoneOn);

        Assert.NotNull((await SkillGoals.EditStepAsync(db, g.Id, outro, new(" ", null), Today)).Error);
        var removed = await SkillGoals.RemoveStepAsync(db, g.Id, outro);
        Assert.Equal(["Intro"], removed!.Steps.Select(s => s.Title));
        Assert.Equal(1, await db.SkillGoalSteps.CountAsync());
    }

    [Fact]
    public async Task A_step_of_another_goal_is_not_found()
    {
        var (db, habit) = await Setup();
        var (a, _) = await SkillGoals.CreateAsync(db, new(habit, "A", null, ["a1"]), Today);
        var (b, _) = await SkillGoals.CreateAsync(db, new(habit, "B", null, null), Today);
        var r = await SkillGoals.EditStepAsync(db, b!.Id, a!.Steps[0].Id, new(null, true), Today);
        Assert.Null(r.Goal);
        Assert.Null(r.Error);
        Assert.Null(await SkillGoals.RemoveStepAsync(db, b.Id, a.Steps[0].Id));
    }

    [Fact]
    public async Task Steps_stop_at_the_limit()
    {
        var (db, habit) = await Setup();
        var (g, _) = await SkillGoals.CreateAsync(db, new(habit, "Big", null, Enumerable.Range(0, SkillGoals.MaxSteps).Select(i => $"s{i}").ToList()), Today);
        Assert.NotNull((await SkillGoals.AddStepAsync(db, g!.Id, new("too many"))).Error);
    }

    [Fact]
    public async Task Editing_changes_the_name_and_note()
    {
        var (db, habit) = await Setup();
        var (g, _) = await SkillGoals.CreateAsync(db, new(habit, "Song", "draft", null), Today);
        var (edited, _) = await SkillGoals.EditAsync(db, g!.Id, new("Finish 'Night Drive'", "  "));
        Assert.Equal("Finish 'Night Drive'", edited!.Title);
        Assert.Null(edited.Note);
    }
}
