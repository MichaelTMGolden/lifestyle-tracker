using PersonalDashboard.Api.Reviews;
using Xunit;

namespace PersonalDashboard.Api.Tests;

public class ReviewEvidenceTests
{
    private static readonly WeeklyDigest Digest = new(
        new DateOnly(2026, 9, 14), new DateOnly(2026, 9, 20),
        new() { new("goal:7", "Practice goal", 60, 30, 8, 100, "ahead", null, null, true) },
        new() { new("skill:3", "Guitar", 60, 30, 2, 2) },
        new() { new("metric:sleep_score", "sleep_score", "Sleep", 80, 75, 5, "score") },
        new("nutrition", 2200, 2200, 150, 150, 3, 3),
        new() { new("alert:5", "GoalPace", "Watch", "Practice pace", "Below target") },
        new("tasks", 4, 1));

    [Fact]
    public void Accepts_real_evidence_across_every_digest_category()
    {
        var output = new ReviewOutput("A productive week.",
            new() { new("goal:7", "You added an hour to the goal."), new("skill:3", "You practised on two days.") },
            new() { new("alert:5", "Your practice pace needs attention.") },
            new() { new("Plan your next practice session.", "high", new() { "goal:7", "skill:3", "metric:sleep_score", "nutrition", "tasks", "alert:5" }) });
        Assert.True(ReviewSynthesisService.ReferencesAreValid(output, Digest));
    }

    [Theory]
    [InlineData("goal:8")]
    [InlineData("skill:99")]
    [InlineData("metric:invented")]
    [InlineData("")]
    public void Rejects_invented_or_missing_win_and_miss_references(string evidence)
    {
        Assert.False(ReviewSynthesisService.ReferencesAreValid(new(null, new() { new(evidence, "A claim.") }, null, null), Digest));
        Assert.False(ReviewSynthesisService.ReferencesAreValid(new(null, null, new() { new(evidence, "A claim.") }, null), Digest));
    }

    [Fact]
    public void Rejects_recommendation_if_even_one_of_its_references_is_invented()
    {
        var output = new ReviewOutput(null, null, null,
            new() { new("Plan practice.", "high", new() { "skill:3", "skill:99" }) });
        Assert.False(ReviewSynthesisService.ReferencesAreValid(output, Digest));
    }

    [Fact]
    public void Recommendations_require_evidence_and_nonempty_action_text()
    {
        Assert.False(ReviewSynthesisService.ReferencesAreValid(new(null, null, null, new() { new("Plan practice.", "high", null) }), Digest));
        Assert.False(ReviewSynthesisService.ReferencesAreValid(new(null, null, null, new() { new("Plan practice.", "high", new()) }), Digest));
        Assert.False(ReviewSynthesisService.ReferencesAreValid(new(null, null, null, new() { new("  ", "high", new() { "skill:3" }) }), Digest));
        Assert.False(ReviewSynthesisService.ReferencesAreValid(new(null, new() { new("skill:3", "") }, null, null), Digest));
    }
}
