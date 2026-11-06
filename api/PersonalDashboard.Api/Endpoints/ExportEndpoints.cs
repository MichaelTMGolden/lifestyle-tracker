using System.Data.Common;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using PersonalDashboard.Api.Data;
using PersonalDashboard.Api.Domain;

namespace PersonalDashboard.Api.Endpoints;

/// <summary>
/// "Download my data": a complete JSON copy of every table, so the data never
/// depends on this app (or Render) to be readable.
///
/// It is driven by the EF model, not a hand-kept list, so a table added later is
/// exported automatically. Each row is Postgres's own <c>row_to_json</c> of the
/// table row, so every column is included, shadow properties too, with no DTO
/// to forget a field. Table names come from the EF model, never from the request.
/// <see cref="AppSecret"/> is the only table left out: it holds encrypted
/// credentials and calendar feed addresses, which a data export should not carry.
/// </summary>
public static class ExportEndpoints
{
    public const int FormatVersion = 1;

    static readonly HashSet<Type> Excluded = [typeof(AppSecret)];

    public static void MapExportEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/export", async (AppDbContext db, HttpContext ctx) =>
        {
            var tables = ExportTables(db);
            var stamp = DateTime.UtcNow.ToString("yyyy-MM-dd");
            ctx.Response.ContentType = "application/json; charset=utf-8";
            ctx.Response.Headers.ContentDisposition = $"attachment; filename=\"dashboard-export-{stamp}.json\"";

            await using var json = new Utf8JsonWriter(ctx.Response.Body, new JsonWriterOptions { Indented = false });
            await WriteExportAsync(db, tables, json, ctx.RequestAborted);
        });
    }

    /// <summary>Every mapped table except the excluded ones, in a stable order.</summary>
    public static IReadOnlyList<string> ExportTables(AppDbContext db) =>
        db.Model.GetEntityTypes()
            .Where(t => !t.IsOwned() && !Excluded.Contains(t.ClrType))
            .Select(t => t.GetTableName())
            .OfType<string>()
            .Distinct()
            .OrderBy(n => n, StringComparer.Ordinal)
            .ToList();

    public static async Task WriteExportAsync(AppDbContext db, IReadOnlyList<string> tables, Utf8JsonWriter json, CancellationToken ct)
    {
        var conn = db.Database.GetDbConnection();
        if (conn.State != System.Data.ConnectionState.Open) await conn.OpenAsync(ct);

        var lastMigration = (await db.Database.GetAppliedMigrationsAsync(ct)).LastOrDefault();
        var counts = new Dictionary<string, long>();

        json.WriteStartObject();
        json.WriteNumber("formatVersion", FormatVersion);
        json.WriteString("exportedAt", DateTimeOffset.UtcNow);
        json.WriteString("schemaMigration", lastMigration);
        json.WriteStartObject("tables");
        foreach (var table in tables)
        {
            json.WritePropertyName(table);
            json.WriteStartArray();
            long n = 0;
            await using (var cmd = conn.CreateCommand())
            {
                cmd.CommandText = $"SELECT row_to_json(t)::text FROM {Quote(table)} t";
                await using DbDataReader reader = await cmd.ExecuteReaderAsync(ct);
                while (await reader.ReadAsync(ct))
                {
                    json.WriteRawValue(reader.GetString(0), skipInputValidation: true);
                    if (++n % 500 == 0) await json.FlushAsync(ct);
                }
            }
            json.WriteEndArray();
            counts[table] = n;
            await json.FlushAsync(ct);
        }
        json.WriteEndObject();

        // Counts last, so the file says what it holds and a reader can check it.
        json.WriteStartObject("rowCounts");
        foreach (var (table, n) in counts) json.WriteNumber(table, n);
        json.WriteEndObject();
        json.WriteEndObject();
        await json.FlushAsync(ct);
    }

    static string Quote(string identifier) => "\"" + identifier.Replace("\"", "\"\"") + "\"";
}
