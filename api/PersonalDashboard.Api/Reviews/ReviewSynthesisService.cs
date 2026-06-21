using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using PersonalDashboard.Api.Data;
using PersonalDashboard.Api.Domain;

namespace PersonalDashboard.Api.Reviews;

public record ReviewFact(string FactId, string Text);
public record ReviewRecommendation(string Text, string? Priority, List<string>? RelatedFactIds);
public record ReviewOutput(string? Narrative, List<ReviewFact>? Wins, List<ReviewFact>? Misses, List<ReviewRecommendation>? Recommendations);

/// <summary>
/// Turns the deterministic weekly digest into a synthesised review via the
/// Anthropic Messages API. The model only judges/prioritises/explains — it is
/// told to use only the numbers provided and never to recompute. Degrades
/// gracefully when no API key is set (mirrors the absent-USDA-key pattern), and
/// stores Status=Failed (never crashes) on transport or parse failure.
///
/// GenerateForWeekAsync is the single entry point so a future scheduled job
/// (ConnectionsAutoSync) can call it on a weekly cadence with no changes.
/// </summary>
public class ReviewSynthesisService
{
    private readonly IHttpClientFactory _http;
    private readonly IConfiguration _cfg;
    private readonly ILogger<ReviewSynthesisService> _log;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public ReviewSynthesisService(IHttpClientFactory http, IConfiguration cfg, ILogger<ReviewSynthesisService> log)
        => (_http, _cfg, _log) = (http, cfg, log);

    private string? ApiKey => _cfg["Anthropic:ApiKey"] ?? Environment.GetEnvironmentVariable("ANTHROPIC_API_KEY");
    public bool IsEnabled => !string.IsNullOrWhiteSpace(ApiKey);
    // Model is configurable; default to the current mid-tier Sonnet (good for this judgment task).
    public string Model => _cfg["Anthropic:Model"] ?? Environment.GetEnvironmentVariable("ANTHROPIC_MODEL") ?? "claude-sonnet-4-6";

    public async Task<WeeklyReview> GenerateForWeekAsync(AppDbContext db, DateOnly weekStart, DateOnly today, CancellationToken ct = default)
    {
        // PRIVACY: only the curated, computed digest (goals + facts) is sent to
        // Anthropic — never raw DB rows.
        var digest = await WeeklyDigestService.BuildAsync(db, weekStart, today);
        var digestJson = JsonSerializer.Serialize(digest, Json);

        // Carry-over: feed the previous week's synthesis so it can say
        // "still slipping" / "improved since last week".
        var prev = await db.WeeklyReviews.AsNoTracking()
            .Where(r => r.WeekStart == weekStart.AddDays(-7) && r.Status == "Generated")
            .Select(r => r.OutputJson).FirstOrDefaultAsync(ct);

        var (status, outputJson, narrative) = await SynthesizeAsync(digestJson, prev, ct);

        var row = await db.WeeklyReviews.FirstOrDefaultAsync(r => r.WeekStart == weekStart, ct);
        if (row is null)
        {
            row = new WeeklyReview { WeekStart = weekStart, DigestJson = digestJson, OutputJson = outputJson, Narrative = narrative, Model = Model, CreatedAt = DateTimeOffset.UtcNow, Status = status };
            db.WeeklyReviews.Add(row);
        }
        else
        {
            row.DigestJson = digestJson; row.OutputJson = outputJson; row.Narrative = narrative;
            row.Model = Model; row.CreatedAt = DateTimeOffset.UtcNow; row.Status = status;
        }
        await db.SaveChangesAsync(ct);
        return row;
    }

    private async Task<(string Status, string OutputJson, string? Narrative)> SynthesizeAsync(string digestJson, string? prevOutputJson, CancellationToken ct)
    {
        var raw = await CallAnthropicAsync(digestJson, prevOutputJson, ct);
        if (raw is null)
            return ("Failed", JsonSerializer.Serialize(new { error = "The review couldn't be generated — check the Anthropic API key and network." }), null);
        try
        {
            var parsed = JsonSerializer.Deserialize<ReviewOutput>(ExtractJson(raw), Json)
                ?? throw new JsonException("empty");
            return ("Generated", JsonSerializer.Serialize(parsed, Json), parsed.Narrative);
        }
        catch
        {
            return ("Failed", JsonSerializer.Serialize(new { error = "Couldn't parse the model's output as JSON.", raw = Truncate(raw, 1500) }), null);
        }
    }

    private async Task<string?> CallAnthropicAsync(string digestJson, string? prevOutputJson, CancellationToken ct)
    {
        try
        {
            var client = _http.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(60);
            var body = new
            {
                model = Model,
                max_tokens = 1600,
                system = SystemPrompt,
                messages = new[] { new { role = "user", content = UserPrompt(digestJson, prevOutputJson) } },
            };
            using var req = new HttpRequestMessage(HttpMethod.Post, "https://api.anthropic.com/v1/messages")
            {
                Content = JsonContent.Create(body),
            };
            req.Headers.Add("x-api-key", ApiKey);
            req.Headers.Add("anthropic-version", "2023-06-01");
            using var resp = await client.SendAsync(req, ct);
            var payload = await resp.Content.ReadAsStringAsync(ct);
            if (!resp.IsSuccessStatusCode)
            {
                _log.LogWarning("Anthropic {Code}: {Body}", (int)resp.StatusCode, Truncate(payload, 400));
                return null;
            }
            using var doc = JsonDocument.Parse(payload);
            return doc.RootElement.GetProperty("content")[0].GetProperty("text").GetString();
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Anthropic call failed.");
            return null;
        }
    }

    private const string SystemPrompt =
        "You are the weekly-review analyst for a single person's self-tracking dashboard. " +
        "You receive a JSON digest of pre-computed facts about this week and the previous week. " +
        "RULES:\n" +
        "- Use ONLY the numbers in the digest. Never invent, estimate, or recompute any figure — the app already did the arithmetic.\n" +
        "- Prioritise: pick the 1–3 things that matter most rather than listing everything.\n" +
        "- Connect across domains where the facts support it (e.g. poor sleep alongside missed practice).\n" +
        "- If a previous review is provided, note carry-over honestly (improved, or still slipping for another week).\n" +
        "- End every recommendation with a concrete next action.\n" +
        "- Reference facts by their exact `id` from the digest.\n" +
        "OUTPUT: Return JSON ONLY (no prose, no code fences) matching exactly:\n" +
        "{\"narrative\": string, \"wins\": [{\"factId\": string, \"text\": string}], " +
        "\"misses\": [{\"factId\": string, \"text\": string}], " +
        "\"recommendations\": [{\"text\": string, \"priority\": \"high\"|\"medium\"|\"low\", \"relatedFactIds\": [string]}]}\n" +
        "The narrative is 2–4 warm, specific sentences. Keep wins/misses to the few that matter.";

    private static string UserPrompt(string digestJson, string? prevOutputJson) =>
        "This week's digest (facts only):\n" + digestJson +
        "\n\nPrevious week's review (for carry-over; null if none):\n" + (prevOutputJson ?? "null") +
        "\n\nReturn the review JSON now.";

    // The model is asked for raw JSON, but strip any stray fences/preamble by
    // taking the outermost { … } span.
    private static string ExtractJson(string s)
    {
        var a = s.IndexOf('{');
        var b = s.LastIndexOf('}');
        return a >= 0 && b > a ? s[a..(b + 1)] : s;
    }

    private static string Truncate(string s, int n) => s.Length <= n ? s : s[..n];
}
