using System.Text.Json.Serialization;
using Microsoft.AspNetCore.ResponseCompression;
using Microsoft.EntityFrameworkCore;
using PersonalDashboard.Api.Data;
using PersonalDashboard.Api.Domain;
using PersonalDashboard.Api.Endpoints;
using PersonalDashboard.Api.Garmin;
using PersonalDashboard.Api.Integrations;
using PersonalDashboard.Api.Nutrition;

var builder = WebApplication.CreateBuilder(args);

// Hosts like Render assign the listening port via $PORT. Bind to it in
// production; locally PORT is unset and launchSettings (:5080) is used.
var port = Environment.GetEnvironmentVariable("PORT");
if (!string.IsNullOrEmpty(port)) builder.WebHost.UseUrls($"http://0.0.0.0:{port}");

// Serialize enums (ScheduleCategory, SourceKind) as their string names so the
// frontend gets "Training"/"Music" rather than 0/1.
builder.Services.ConfigureHttpJsonOptions(o =>
    o.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));

// Connection string precedence: configured "Postgres" → DATABASE_URL (managed
// hosts hand you a postgres:// URL) → local docker-compose default.
var rawConn = builder.Configuration.GetConnectionString("Postgres")
    ?? Environment.GetEnvironmentVariable("DATABASE_URL")
    ?? "Host=localhost;Port=5432;Database=personal_dashboard;Username=dashboard;Password=dashboard";
var connectionString = NormalizePostgres(rawConn);

builder.Services.AddDbContext<AppDbContext>(opt => opt.UseNpgsql(connectionString));

// Allow the Vite dev server to call the API during development.
const string DevCors = "dev-cors";
builder.Services.AddCors(opt => opt.AddPolicy(DevCors, p => p
    .WithOrigins("http://localhost:5173")
    .AllowAnyHeader()
    .AllowAnyMethod()));

builder.Services.AddEndpointsApiExplorer();

// Compress API responses (metric series / music lists can be large).
builder.Services.AddResponseCompression(o =>
{
    o.EnableForHttps = true;
    o.MimeTypes = ResponseCompressionDefaults.MimeTypes.Concat(new[] { "application/json" });
});

// Food-database lookup (server-side proxy over Open Food Facts + USDA). Calls
// run here, never the browser, so the USDA key stays server-side and we set a
// descriptive User-Agent that OFF requires. USDA key lives in user-secrets / env
// under "Usda:ApiKey" (see README) — absent key just disables the USDA source.
builder.Services.AddMemoryCache();
builder.Services.AddHttpClient("off", c =>
{
    c.DefaultRequestHeaders.UserAgent.ParseAdd("PersonalDashboard/0.1 (self-hosted; contact: local@dev)");
    c.Timeout = TimeSpan.FromSeconds(6);
});
builder.Services.AddHttpClient("usda", c => c.Timeout = TimeSpan.FromSeconds(6));
builder.Services.AddSingleton<FoodSearchService>();

// Data-source providers. Garmin import is live today; the rest are labelled
// seams that go live by implementing IDataProvider + flipping Configured.
builder.Services.AddSingleton<IDataProvider, GarminImportProvider>();
builder.Services.AddSingleton<IDataProvider>(new PendingProvider(
    SourceKind.MyFitnessPal, "MyFitnessPal", ProviderMode.Import, "no public API — connect via CSV export/import"));
builder.Services.AddSingleton<IDataProvider>(new PendingProvider(
    SourceKind.GoogleCalendar, "Google Calendar", ProviderMode.Api, "awaiting OAuth credentials"));
builder.Services.AddSingleton<IDataProvider>(new PendingProvider(
    SourceKind.Spotify, "Spotify", ProviderMode.Api, "awaiting OAuth credentials"));
builder.Services.AddSingleton<IDataProvider>(new PendingProvider(
    SourceKind.Manual, "Manual entry", ProviderMode.Manual, "always on — weight, to-dos & habits by hand", configured: true));

var app = builder.Build();

// Apply migrations and seed dummy data on startup (dev convenience).
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    await db.Database.MigrateAsync();
    await DataSeeder.SeedAsync(db);

    // Daily to-dos aren't kept long-term — purge prior days at startup (server
    // local date is fine here; per-request cleanup also runs on create).
    var purgeBefore = DateOnly.FromDateTime(DateTime.UtcNow.Date);
    await db.DailyTodos.Where(t => t.Date < purgeBefore).ExecuteDeleteAsync();

    // CLI: `dotnet run -- import-garmin <dir> [--keep-dates]`
    // Imports Garmin CSVs then exits without starting the web server.
    if (args.Length > 0 && args[0] == "import-garmin")
    {
        var dir = args.Length > 1 && !args[1].StartsWith("--")
            ? args[1]
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
        var keepDates = args.Contains("--keep-dates");

        var importer = new GarminCsvImporter(db);
        var result = await importer.ImportAsync(dir, shiftToToday: !keepDates);
        Console.WriteLine($"[garmin] {result.HealthDays} health days, {result.SleepDays} sleep days, " +
                          $"{result.SamplesWritten} samples written. {result.Notes}");
        return;
    }
}

app.UseResponseCompression();
// Serve the built React SPA (copied into wwwroot by the Docker image). No-op in
// dev where the SPA runs on the Vite server instead.
app.UseDefaultFiles();
app.UseStaticFiles();
app.UseCors(DevCors);

app.MapGet("/healthz", () => Results.Ok(new { status = "ok", service = "personal-dashboard-api" }));
app.MapApiEndpoints();
// Anything not an API route or a static file → the SPA entrypoint (client-side routing).
app.MapFallbackToFile("index.html");

app.Run();

// Convert a postgres:// URL (managed hosts) into the key/value form Npgsql wants.
// Pass-through if it's already key/value.
static string NormalizePostgres(string raw)
{
    if (!raw.StartsWith("postgres://") && !raw.StartsWith("postgresql://")) return raw;
    var uri = new Uri(raw);
    var parts = uri.UserInfo.Split(':', 2);
    return new Npgsql.NpgsqlConnectionStringBuilder
    {
        Host = uri.Host,
        Port = uri.Port > 0 ? uri.Port : 5432,
        Username = Uri.UnescapeDataString(parts[0]),
        Password = parts.Length > 1 ? Uri.UnescapeDataString(parts[1]) : "",
        Database = uri.AbsolutePath.TrimStart('/'),
        SslMode = Npgsql.SslMode.Require, // Require (not VerifyFull) → no cert validation, fine for managed hosts
    }.ConnectionString;
}
