using System.Net.Http.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.EntityFrameworkCore;
using PersonalDashboard.Api;
using PersonalDashboard.Api.Data;
using PersonalDashboard.Api.Domain;
using PersonalDashboard.Api.Alerts;
using PersonalDashboard.Api.Challenges;
using PersonalDashboard.Api.Garmin;
using PersonalDashboard.Api.Goals;
using PersonalDashboard.Api.Health;
using PersonalDashboard.Api.Integrations;
using PersonalDashboard.Api.Nutrition;
using PersonalDashboard.Api.Reviews;
using PersonalDashboard.Api.Schedule;

namespace PersonalDashboard.Api.Endpoints;

public record BingoSquareInput(string? Label, string? Note);
public record BingoTitleInput(string? Title);

// The yearly bingo board.
public static partial class ApiEndpoints
{
    // The 12 bingo lines as position sets (row = pos/5, col = pos%5). Order is the
    // line id the client mirrors: 5 rows, 5 cols, 2 diagonals.
    private static readonly int[][] BingoLines =
    {
        new[] { 0, 1, 2, 3, 4 }, new[] { 5, 6, 7, 8, 9 }, new[] { 10, 11, 12, 13, 14 },
        new[] { 15, 16, 17, 18, 19 }, new[] { 20, 21, 22, 23, 24 },
        new[] { 0, 5, 10, 15, 20 }, new[] { 1, 6, 11, 16, 21 }, new[] { 2, 7, 12, 17, 22 },
        new[] { 3, 8, 13, 18, 23 }, new[] { 4, 9, 14, 19, 24 },
        new[] { 0, 6, 12, 18, 24 }, new[] { 4, 8, 12, 16, 20 },
    };

    private static async Task<Domain.BingoBoard> EnsureBingoBoardAsync(AppDbContext db, int year)
    {
        var board = await db.BingoBoards.Include(b => b.Squares).FirstOrDefaultAsync(b => b.Year == year);
        if (board is null)
        {
            board = new Domain.BingoBoard { Year = year, CreatedAt = DateTimeOffset.UtcNow };
            for (var p = 0; p < 25; p++) board.Squares.Add(new Domain.BingoSquare { Position = p, Label = "" });
            db.BingoBoards.Add(board);
            await db.SaveChangesAsync();
        }
        return board;
    }

    private static object BingoPayload(Domain.BingoBoard board)
    {
        var squares = board.Squares.OrderBy(s => s.Position).ToList();
        var completed = squares.Where(s => s.Completed).Select(s => s.Position).ToHashSet();
        var completedLines = new List<int>();
        for (var i = 0; i < BingoLines.Length; i++)
            if (BingoLines[i].All(completed.Contains)) completedLines.Add(i);
        return new
        {
            board.Year,
            board.Title,
            squares = squares.Select(s => new { s.Id, s.Position, s.Label, s.Note, s.Completed, s.CompletedAt }),
            completedCount = completed.Count,
            completedLines,
            blackout = completed.Count == 25,
        };
    }

    private static void MapBingo(RouteGroupBuilder api)
    {
        // --- Bingo (annual milestone board) ---
        api.MapGet("/bingo", async (AppDbContext db, HttpRequest req, int? year) =>
        {
            var y = year ?? ClientClock.From(req).Today.Year;
            return Results.Ok(BingoPayload(await EnsureBingoBoardAsync(db, y)));
        });

        api.MapGet("/bingo/years", async (AppDbContext db) =>
            await db.BingoBoards.OrderByDescending(b => b.Year).Select(b => b.Year).ToListAsync());

        api.MapPut("/bingo/squares/{id:int}", async (int id, BingoSquareInput input, AppDbContext db) =>
        {
            var sq = await db.BingoSquares.FindAsync(id);
            if (sq is null) return Results.NotFound();
            if (input.Label is not null) sq.Label = input.Label.Trim();
            if (input.Note is not null) sq.Note = string.IsNullOrWhiteSpace(input.Note) ? null : input.Note;
            // A blank square can't stay completed.
            if (string.IsNullOrEmpty(sq.Label)) { sq.Completed = false; sq.CompletedAt = null; }
            await db.SaveChangesAsync();
            var board = await db.BingoBoards.Include(b => b.Squares).FirstAsync(b => b.Id == sq.BoardId);
            return Results.Ok(BingoPayload(board));
        });

        api.MapPost("/bingo/squares/{id:int}/toggle", async (int id, AppDbContext db) =>
        {
            var sq = await db.BingoSquares.FindAsync(id);
            if (sq is null) return Results.NotFound();
            if (!sq.Completed && string.IsNullOrWhiteSpace(sq.Label))
                return Results.BadRequest(new { error = "Name the goal before marking it done" });
            sq.Completed = !sq.Completed;
            sq.CompletedAt = sq.Completed ? DateTimeOffset.UtcNow : null;
            await db.SaveChangesAsync();
            var board = await db.BingoBoards.Include(b => b.Squares).FirstAsync(b => b.Id == sq.BoardId);
            return Results.Ok(BingoPayload(board));
        });

        api.MapPut("/bingo/board/{year:int}", async (int year, BingoTitleInput input, AppDbContext db) =>
        {
            var board = await EnsureBingoBoardAsync(db, year);
            board.Title = string.IsNullOrWhiteSpace(input.Title) ? null : input.Title.Trim();
            await db.SaveChangesAsync();
            return Results.Ok(BingoPayload(board));
        });
    }
}
