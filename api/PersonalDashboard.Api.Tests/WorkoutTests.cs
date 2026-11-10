using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using PersonalDashboard.Api.Data;
using PersonalDashboard.Api.Domain;
using PersonalDashboard.Api.Integrations;
using Xunit;

namespace PersonalDashboard.Api.Tests;

public class WorkoutTests
{
    private static readonly DateOnly Today = new(2026, 11, 10);
    private static DateOnly UtcDay(DateTimeOffset t) => DateOnly.FromDateTime(t.UtcDateTime);

    private static AppDbContext Database() => new(new DbContextOptionsBuilder<AppDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString())
        .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning)).Options);

    private static JsonElement Json(string s) => JsonDocument.Parse(s).RootElement;

    [Fact]
    public void Health_auto_export_v2_is_read_with_units_converted()
    {
        var (list, skipped) = HealthIngest.Parse(Json("""
          {"data": {"metrics": [], "workouts": [{
            "id": "A1", "name": "Outdoor Run", "start": "2026-11-09 06:30:00 +1100", "end": "2026-11-09 07:00:00 +1100",
            "duration": 1800, "distance": {"qty": 3.1, "units": "mi"}, "activeEnergyBurned": {"qty": 320.4, "units": "kcal"},
            "avgHeartRate": {"qty": 151.6, "units": "count/min"}
          }]}}
          """));
        Assert.Equal(0, skipped);
        var w = Assert.Single(list);
        Assert.Equal("A1", w.ExternalId);
        Assert.Equal("Run", w.Type);
        Assert.Equal(30, w.DurationMinutes);
        Assert.Equal(4989, Math.Round(w.DistanceMeters!.Value));
        Assert.Equal(320, w.Calories);
        Assert.Equal(152, w.AverageHeartRate);
        Assert.Equal(new DateTimeOffset(2026, 11, 9, 6, 30, 0, TimeSpan.FromHours(11)), w.StartedAt);
        Assert.Equal(new DateOnly(2026, 11, 9), WorkoutStore.OwnDay(w.StartedAt)); // local day, not UTC's 8th
    }

    [Fact]
    public void V1_and_shortcut_shapes_work_and_bad_items_are_skipped()
    {
        var (list, skipped) = HealthIngest.Parse(Json("""
          {"workouts": [
            {"name": "Walking", "start": "2026-11-08T08:00:00+11:00", "end": "2026-11-08T08:45:00+11:00", "distance": {"qty": 4.2, "units": "km"}, "heartRate": {"avg": {"qty": 101}}},
            {"name": "Yoga"},
            {"start": "2026-11-08 08:00:00 +1100"},
            "nonsense"
          ]}
          """));
        Assert.Equal(3, skipped);
        var w = Assert.Single(list);
        Assert.Equal("Walk", w.Type);
        Assert.Equal(45, w.DurationMinutes); // from end − start
        Assert.Equal(4200, w.DistanceMeters);
        Assert.Equal(101, w.AverageHeartRate);
        Assert.StartsWith("Walking|", w.ExternalId); // no id: stable from name and start
        Assert.Empty(HealthIngest.Parse(Json("""{"something": 1}""")).Workouts);
    }

    [Fact]
    public async Task Upserting_the_same_workout_updates_it_and_replaces_its_sets()
    {
        var db = Database();
        var src = await WorkoutStore.SourceAsync(db, SourceKind.Hevy, "Hevy");
        var start = new DateTimeOffset(2026, 11, 9, 7, 0, 0, TimeSpan.Zero);
        IncomingSet S(int i, double kg) => new(0, "Bench Press", "T1", i, "normal", kg, 5, null, null, null);
        Assert.True(await WorkoutStore.UpsertAsync(db, src, new("H1", "Strength", "Push", start, start.AddMinutes(50), 50, null, null, null, [S(0, 60), S(1, 70)]), Today, null, UtcDay));
        Assert.False(await WorkoutStore.UpsertAsync(db, src, new("H1", "Strength", "Push day", start, start.AddMinutes(55), 55, null, null, null, [S(0, 80)]), Today, null, UtcDay));
        var w = Assert.Single(await db.Workouts.Include(x => x.Sets).ToListAsync());
        Assert.Equal("Push day", w.Title);
        Assert.Equal(55, w.DurationMinutes);
        Assert.Equal(80, Assert.Single(w.Sets).WeightKg);
    }

    [Fact]
    public async Task A_new_workout_ticks_its_habit_once_and_only_recent_ones()
    {
        var db = Database();
        var lift = new Habit { Name = "Exercise", TracksTime = true };
        var run = new Habit { Name = "Running" };
        db.Habits.AddRange(lift, run);
        await db.SaveChangesAsync();
        var habits = new WorkoutHabits(lift.Id, run.Id, null);
        var src = await WorkoutStore.SourceAsync(db, SourceKind.AppleHealth, "Apple Health");
        var yesterday = new DateTimeOffset(2026, 11, 9, 18, 0, 0, TimeSpan.Zero);

        await WorkoutStore.UpsertAsync(db, src, new("L1", "Strength", null, yesterday, null, 40, null, null, null), Today, habits, UtcDay);
        await WorkoutStore.UpsertAsync(db, src, new("L1", "Strength", null, yesterday, null, 40, null, null, null), Today, habits, UtcDay); // re-sync
        await WorkoutStore.UpsertAsync(db, src, new("R1", "Run", null, yesterday, null, 30, 5000, null, null), Today, habits, UtcDay);
        await WorkoutStore.UpsertAsync(db, src, new("OLD", "Run", null, yesterday.AddDays(-30), null, 30, 5000, null, null), Today, habits, UtcDay);
        await WorkoutStore.UpsertAsync(db, src, new("Y1", "Yoga", null, yesterday, null, 20, null, null, null), Today, habits, UtcDay); // Other: none set

        var logs = await db.HabitLogs.AsNoTracking().ToListAsync();
        var liftLog = Assert.Single(logs, l => l.HabitId == lift.Id);
        Assert.Equal(40, liftLog.Minutes); // timed habit: minutes, added once
        Assert.True(Assert.Single(logs, l => l.HabitId == run.Id).Completed); // the 30-day-old run didn't tick
        Assert.Equal(2, logs.Count);
    }

    [Fact]
    public void Request_ids_are_stable_per_workout()
    {
        Assert.Equal(WorkoutStore.RequestId(SourceKind.Hevy, "x"), WorkoutStore.RequestId(SourceKind.Hevy, "x"));
        Assert.NotEqual(WorkoutStore.RequestId(SourceKind.Hevy, "x"), WorkoutStore.RequestId(SourceKind.AppleHealth, "x"));
    }

    [Fact]
    public async Task Hevy_imports_everything_then_only_changes()
    {
        var db = Database();
        var calls = new List<string>();
        var handler = new FakeHevy(req =>
        {
            calls.Add(req.RequestUri!.PathAndQuery);
            Assert.Equal("KEY", req.Headers.GetValues("api-key").Single());
            var q = req.RequestUri.PathAndQuery;
            if (q.StartsWith("/v1/workouts?page=1")) return Page(1, 2, Workout("W1", "Push", 60), Workout("W2", "Pull", 70));
            if (q.StartsWith("/v1/workouts?page=2")) return Page(2, 2, Workout("W3", "Legs", 100));
            if (q.StartsWith("/v1/workouts/events?page=1"))
                return $$"""{"page":1,"page_count":1,"events":[{"type":"updated","workout":{{Workout("W1", "Push heavy", 90)}}},{"type":"deleted","id":"W2","deleted_at":"2026-11-10T00:00:00Z"}]}""";
            return null;
        });
        var http = new HttpClient(handler);

        var first = await HevySync.SyncAsync(db, http, "KEY", Today, UtcDay);
        Assert.True(first.Ok);
        Assert.Equal(3, first.Created);
        Assert.Equal(3, await db.Workouts.CountAsync());
        Assert.Equal(6, await db.WorkoutSets.CountAsync());
        Assert.True(await db.AppSecrets.AnyAsync(s => s.Key == HevySync.CursorSecret));

        var second = await HevySync.SyncAsync(db, http, "KEY", Today, UtcDay);
        Assert.True(second.Ok);
        Assert.Equal((0, 1, 1), (second.Created, second.Updated, second.Deleted));
        var titles = await db.Workouts.OrderBy(w => w.ExternalId).Select(w => w.Title).ToListAsync();
        Assert.Equal(["Push heavy", "Legs"], titles);
        Assert.Contains(calls, c => c.StartsWith("/v1/workouts/events?page=1&pageSize=10&since="));
    }

    [Fact]
    public async Task A_rejected_key_reports_why()
    {
        var http = new HttpClient(new FakeHevy(_ => null, HttpStatusCode.Unauthorized));
        Assert.NotNull(await HevySync.CheckKeyAsync(http, "bad"));
        var r = await HevySync.SyncAsync(Database(), http, "bad", Today, UtcDay);
        Assert.False(r.Ok);
    }

    static string Workout(string id, string title, double kg) => $$"""
      {"id":"{{id}}","title":"{{title}}","start_time":"2026-11-09T07:00:00Z","end_time":"2026-11-09T08:00:00Z","updated_at":"2026-11-09T08:00:00Z",
       "exercises":[{"index":0,"title":"Bench Press","exercise_template_id":"T1","sets":[
         {"index":0,"type":"warmup","weight_kg":40,"reps":10},{"index":1,"type":"normal","weight_kg":{{kg}},"reps":5}]}]}
      """;
    static string Page(int page, int count, params string[] workouts) => $$"""{"page":{{page}},"page_count":{{count}},"workouts":[{{string.Join(",", workouts)}}]}""";

    sealed class FakeHevy(Func<HttpRequestMessage, string?> body, HttpStatusCode failWith = HttpStatusCode.NotFound) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage req, CancellationToken ct)
        {
            if (req.RequestUri!.AbsolutePath == "/v1/user/info" && failWith != HttpStatusCode.Unauthorized)
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{}") });
            var text = failWith == HttpStatusCode.Unauthorized ? null : body(req);
            return Task.FromResult(text is null
                ? new HttpResponseMessage(failWith)
                : new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(text, Encoding.UTF8, "application/json") });
        }
    }
}
