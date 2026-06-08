using Microsoft.EntityFrameworkCore;
using PersonalDashboard.Api.Domain;

namespace PersonalDashboard.Api.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<DataSource> DataSources => Set<DataSource>();
    public DbSet<MetricSample> MetricSamples => Set<MetricSample>();
    public DbSet<Workout> Workouts => Set<Workout>();
    public DbSet<CalendarEvent> CalendarEvents => Set<CalendarEvent>();
    public DbSet<MusicPlay> MusicPlays => Set<MusicPlay>();
    public DbSet<Habit> Habits => Set<Habit>();
    public DbSet<HabitLog> HabitLogs => Set<HabitLog>();
    public DbSet<Goal> Goals => Set<Goal>();
    public DbSet<GoalSource> GoalSources => Set<GoalSource>();
    public DbSet<TodoItem> TodoItems => Set<TodoItem>();
    public DbSet<ScheduleBlock> ScheduleBlocks => Set<ScheduleBlock>();
    public DbSet<DailyTodo> DailyTodos => Set<DailyTodo>();
    public DbSet<FoodEntry> FoodEntries => Set<FoodEntry>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<DataSource>().HasIndex(x => new { x.Kind, x.Name }).IsUnique();

        // Query index (filter by key + time) plus a uniqueness guard so future
        // incremental syncs can upsert instead of double-counting.
        b.Entity<MetricSample>().HasIndex(x => new { x.MetricKey, x.RecordedAt });
        b.Entity<MetricSample>().HasIndex(x => new { x.DataSourceId, x.MetricKey, x.RecordedAt }).IsUnique();
        b.Entity<Workout>().HasIndex(x => x.StartedAt);
        b.Entity<CalendarEvent>().HasIndex(x => x.StartsAt);
        b.Entity<CalendarEvent>().HasIndex(x => x.ExternalId);
        b.Entity<MusicPlay>().HasIndex(x => x.PlayedAt);

        // One log per habit per day — this is what makes minutes-per-day work.
        b.Entity<HabitLog>().HasIndex(x => new { x.HabitId, x.Date }).IsUnique();

        // A skill feeds a goal at most once; deleting a goal removes its joins.
        b.Entity<GoalSource>().HasIndex(x => new { x.GoalId, x.HabitId }).IsUnique();
        b.Entity<GoalSource>()
            .HasOne(x => x.Goal).WithMany(g => g.Sources)
            .HasForeignKey(x => x.GoalId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<GoalSource>()
            .HasOne(x => x.Habit).WithMany()
            .HasForeignKey(x => x.HabitId).OnDelete(DeleteBehavior.Cascade);

        b.Entity<TodoItem>().HasIndex(x => x.DueAt);

        b.Entity<ScheduleBlock>().HasIndex(x => new { x.Day, x.StartMinutes });

        b.Entity<DailyTodo>().HasIndex(x => x.Date);

        b.Entity<FoodEntry>().HasIndex(x => x.Date);
        b.Entity<FoodEntry>()
            .HasOne(x => x.DataSource).WithMany()
            .HasForeignKey(x => x.DataSourceId).OnDelete(DeleteBehavior.Restrict);
    }
}
