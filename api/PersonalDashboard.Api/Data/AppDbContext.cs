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
    public DbSet<HabitTimer> HabitTimers => Set<HabitTimer>();
    public DbSet<AppSecret> AppSecrets => Set<AppSecret>();
    public DbSet<Goal> Goals => Set<Goal>();
    public DbSet<GoalSource> GoalSources => Set<GoalSource>();
    public DbSet<TodoItem> TodoItems => Set<TodoItem>();
    public DbSet<ScheduleBlock> ScheduleBlocks => Set<ScheduleBlock>();
    public DbSet<ScheduleOverride> ScheduleOverrides => Set<ScheduleOverride>();
    public DbSet<DailyTodo> DailyTodos => Set<DailyTodo>();
    public DbSet<FoodEntry> FoodEntries => Set<FoodEntry>();
    public DbSet<Alert> Alerts => Set<Alert>();
    public DbSet<BingoBoard> BingoBoards => Set<BingoBoard>();
    public DbSet<BingoSquare> BingoSquares => Set<BingoSquare>();
    public DbSet<SavedFood> SavedFoods => Set<SavedFood>();
    public DbSet<QuickMeal> QuickMeals => Set<QuickMeal>();
    public DbSet<QuickMealItem> QuickMealItems => Set<QuickMealItem>();

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

        b.Entity<AppSecret>().HasKey(x => x.Key);
        // New column backfills to true for existing habits (so they stay in quick actions).
        b.Entity<Habit>().Property(h => h.ShowInQuickActions).HasDefaultValue(true);

        // At most one running timer per habit; deleting the habit clears it.
        b.Entity<HabitTimer>().HasIndex(x => x.HabitId).IsUnique();
        b.Entity<HabitTimer>()
            .HasOne(x => x.Habit).WithMany()
            .HasForeignKey(x => x.HabitId).OnDelete(DeleteBehavior.Cascade);

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
        // One override per block per week; cascade so re-importing the schedule clears them.
        b.Entity<ScheduleOverride>().HasIndex(x => new { x.ScheduleBlockId, x.WeekStart }).IsUnique();
        b.Entity<ScheduleOverride>()
            .HasOne(x => x.ScheduleBlock).WithMany()
            .HasForeignKey(x => x.ScheduleBlockId).OnDelete(DeleteBehavior.Cascade);

        b.Entity<DailyTodo>().HasIndex(x => x.Date);

        b.Entity<FoodEntry>().HasIndex(x => x.Date);
        b.Entity<FoodEntry>()
            .HasOne(x => x.DataSource).WithMany()
            .HasForeignKey(x => x.DataSourceId).OnDelete(DeleteBehavior.Restrict);

        // Regeneration upserts by DedupeKey instead of duplicating.
        b.Entity<Alert>().HasIndex(x => x.DedupeKey).IsUnique();
        b.Entity<Alert>().HasIndex(x => x.Status);

        // Remembered foods dedupe on (Name, Brand, ExternalRef) — repeats increment instead of duplicating.
        b.Entity<SavedFood>().HasIndex(x => new { x.Name, x.Brand, x.ExternalRef }).IsUnique();
        b.Entity<QuickMealItem>()
            .HasOne(x => x.QuickMeal).WithMany(m => m.Items)
            .HasForeignKey(x => x.QuickMealId).OnDelete(DeleteBehavior.Cascade);

        // One bingo board per year; one square per position; squares cascade with the board.
        b.Entity<BingoBoard>().HasIndex(x => x.Year).IsUnique();
        b.Entity<BingoSquare>().HasIndex(x => new { x.BoardId, x.Position }).IsUnique();
        b.Entity<BingoSquare>()
            .HasOne(x => x.Board).WithMany(bd => bd.Squares)
            .HasForeignKey(x => x.BoardId).OnDelete(DeleteBehavior.Cascade);
    }
}
