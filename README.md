# Personal Dashboard

A self-hosted personal dashboard tracking fitness, calendar, music, habits, and
to-dos. Built to start fully local with dummy data, then swap in real
integrations (Google Calendar, Spotify, Garmin, MyFitnessPal) one at a time.

## Stack

- **API:** C# / ASP.NET Core 9 Minimal APIs + EF Core (Npgsql)
- **DB:** Postgres 17 (Docker)
- **Web:** Vite + React + TypeScript + Recharts — gothic theme, **responsive for
  iPhone** (mobile prioritises Now / daily to-dos / quick log / upcoming).
- **Dummy data:** [Bogus](https://github.com/bchavez/Bogus) seeder (~90 days)
- **Timezone-aware:** the web app sends the device's UTC offset (`X-Tz-Offset`
  header) and the API resolves "today / now" in the user's local time — correct
  while travelling. See [`ClientClock`](api/PersonalDashboard.Api/ClientClock.cs).

## Layout

```
personal-dashboard/
├── docker-compose.yml        # Postgres + pgAdmin
├── api/PersonalDashboard.Api # C# API, EF Core, domain model, seeder
└── web/                      # Vite React frontend
```

## Running it

> **Note on Docker:** Docker Desktop's CLI may not be on your PATH. If `docker`
> isn't found, either open a new terminal after install or add
> `C:\Program Files\Docker\Docker\resources\bin` to PATH.

### 1. Start Postgres

```powershell
docker compose up -d db          # add `pgadmin` too if you want the web UI
```

Postgres → `localhost:5432` (db `personal_dashboard`, user/pass `dashboard`/`dashboard`).
pgAdmin (optional) → http://localhost:8080 (`admin@local.dev` / `admin`).

### 2. Run the API

```powershell
cd api/PersonalDashboard.Api
dotnet run
```

On first start it **applies migrations and seeds ~90 days of dummy data**
automatically. API → http://localhost:5080. Try http://localhost:5080/api/summary.

### 2b. (Optional) Import Garmin data

Drop Garmin research-export CSVs (`garmin-health-daily.csv`,
`garmin_api_sleep_daily.csv`) somewhere and run:

```powershell
cd api/PersonalDashboard.Api
dotnet run -- import-garmin "C:\path\to\csv\folder"   # defaults to ~/Downloads
```

It imports steps, heart rate, calories, distance, stress, and per-night sleep
stages into `MetricSample` rows under a "Garmin (imported)" source. For sample
data it picks the single richest user, dedupes sleep by validation quality, and
**shifts dates so the latest record is today** (so the dashboard isn't empty).
Pass `--keep-dates` to preserve original dates — use that for your own real data.
The importer ([GarminCsvImporter.cs](api/PersonalDashboard.Api/Garmin/GarminCsvImporter.cs))
is re-runnable and is the foundation of the eventual live Garmin integration.

### 2c. (Optional) Food search — USDA API key

Food **search** is a server-side proxy over two free databases, normalized into
one shape ([`FoodSearchService`](api/PersonalDashboard.Api/Nutrition/FoodSearchService.cs)):

- **Open Food Facts** (branded/packaged) — no key; we send a descriptive
  `User-Agent` and bias to Ireland (`country=ie`) by default.
- **USDA FoodData Central** (generic whole foods) — needs a free key. This is the
  project's first external key, so it sets the pattern: **keep it out of git**, in
  user-secrets (dev) or an env var. Without a key, USDA is simply skipped and Open
  Food Facts still works; if either source is down the endpoint returns partial
  results rather than failing.

```powershell
cd api/PersonalDashboard.Api
dotnet user-secrets set "Usda:ApiKey" "<your-fdc-key>"   # from https://fdc.nal.usda.gov/api-key-signup.html
# or, instead of user-secrets:  $env:Usda__ApiKey = "<your-fdc-key>"
```

Logging itself (manual entry + the day's editable per-food list) needs no key —
only the search autocomplete does. *Barcode lookup is designed for but not yet
implemented* (a `LookupByBarcodeAsync` slots into the same service).

### 3. Run the frontend

```powershell
cd web
npm install        # first time only
npm run dev
```

Web → http://localhost:5173 (Vite proxies `/api` to the C# server on :5080).

## Data model

Everything is designed around the integrations being **interchangeable data
sources** feeding shared tables. Dummy data and a real Spotify sync land in the
same place — only the `DataSource.Kind` tag differs. That's what lets you build
the whole app on fake data now and add real syncs later without rework.

- `DataSource` — where data came from (Manual / Spotify / Garmin / GoogleCalendar / MyFitnessPal / OpenFoodFacts / Usda)
- `MetricSample` — generic numeric time series (weight, resting HR, steps, sleep, calories, **macros**)
- `Workout`, `MusicPlay`, `CalendarEvent` — domain-specific event tables
- `FoodEntry` — one logged food item per day (per-item list); daily macro totals are
  materialized into `MetricSample` (`calories_in` / `protein_g` / `carbs_g` / `fat_g`)
  under a "Nutrition (rollup)" source so the Health page reads them generically
- `Habit` + `HabitLog`, `TodoItem`
- `ScheduleBlock` — recurring weekly timetable (read-only template), seeded from
  [`SeedData/weekly_timetable.md`](api/PersonalDashboard.Api/SeedData/weekly_timetable.md)
  via [`ScheduleParser`](api/PersonalDashboard.Api/Schedule/ScheduleParser.cs).

## Frontend pages (React Router)

- **`/` Today** — launchpad: time-aware framing line; a **Now + Next** panel
  (elapsed/remaining + day-progress + tomorrow preview); a grouped **stat strip**
  (readiness gauge, sleep/resting-HR/steps sparkline tiles, an energy/Body-Battery
  curve, and productivity cards with **overdue surfaced**); then two columns —
  daily to-dos + quick-log practice + **weekly habit grid** + momentum on the left,
  calendar + schedule (merged timeline, events **render once**, overlapping blocks
  **dimmed not struck**, collapse-past + now-line) + tasks on the right. Most of it
  is powered by a single enriched `/api/today`. A redesigned standalone mockup of this launchpad —
  Now+Next, grouped/context stat strip, fixed schedule (single spanning calendar
  blocks, no auto-strikethrough, collapse-past), weekly habit grid, time-aware
  framing — lives at [`mockups/today-homepage.html`](mockups/today-homepage.html).
- **`/nutrition`** — **Nutrition**: per-food logging with a date selector. Search
  foods (Open Food Facts + USDA, with a source badge) → pick → quantity/serving →
  logs an entry with computed as-eaten macros; a manual form covers anything not
  found. The day's entries are grouped by meal and editable/deletable inline, with
  a totals bar (calories + P/C/F vs targets, protein highlighted, plus calories-in
  vs calories-out net using Garmin active). Every create/edit/delete recomputes the
  day's `calories_in` / `protein_g` / `carbs_g` / `fat_g` rollup.
- **`/tasks`** — long-term **Tasks**: add, inline-edit, delete, due dates, priority.
- **`/connect`** — **Connections**: every data source (Garmin, MyFitnessPal, Google
  Calendar, Spotify, Manual) with status / last-sync / record count, a **Sync now**
  action, and **Upload export** for file-based import. See Integrations below.
- **Daily to-dos** — lightweight items filled fresh each day on the Today page
  (added/checked/removed there); they're *not* kept long-term (older days are
  purged) and are what the "Focus" glance widget rotates through at the top.
- **`/habits`** — GitHub-style contribution heatmaps for tracked daily practices
  (Singing, Guitar, Writing, Reading, + anchors), with streak/total and a
  one-tap "log today" per habit.
- **`/schedule`** — the full recurring weekly timetable, colour-coded by category,
  today highlighted, with a live **"now" line** in today's column.
- **`/health`** — a "personal intelligence briefing" dashboard: a **Readiness
  hero** (0–100 + label, composed from sleep/resting-HR/stress with transparent
  chips), **context-rich vitals** (each with target/range, healthy-direction trend
  semantics, and a sparkline with goal/baseline line), **insights + actions**
  (trends and Pearson relationships, low-confidence flagged), an **interactive
  scatter correlation explorer** (any metric vs any metric, fitted trend line +
  plain-English read), plus Sleep / Recovery / Activity / Nutrition / Body-comp
  sections and **manual weight entry**. A global **time-range selector** (2W–1Y)
  drives the page. Modules that need Garmin/MFP data not yet ingested (HRV, Body
  Battery, training load, VO₂max, macros) render as labelled "awaiting sync"
  placeholders. A standalone design mockup of this lives at
  [`mockups/health-dashboard.html`](mockups/health-dashboard.html). Drill into any
  metric at **`/health/:key`**.

  > Note: the Garmin sample's stress & resting-HR are too sparse for trends, so
  > [`GarminCsvImporter`](api/PersonalDashboard.Api/Garmin/GarminCsvImporter.cs)
  > **derives** them from the (dense) sleep series — stress inverse to sleep, and
  > resting HR on a gentle downward fitness trend. Real data would replace this.

## API endpoints

| Method | Route | Purpose |
|--------|-------|---------|
| GET  | `/api/today` | At-a-glance homepage rollup (steps, sleep, habits, next-up) |
| GET  | `/api/schedule/week` | Weekly timetable grouped by day |
| GET  | `/api/schedule/today` | Today's blocks + events, with calendar precedence |
| GET  | `/api/summary` | Legacy rollup |
| GET  | `/api/metrics` | List available metric keys |
| GET  | `/api/metrics/{key}?days=90` | Time series (e.g. `weight_kg`, `steps`) |
| POST | `/api/weight` | Log today's weight manually (`{value}`) |
| GET  | `/api/connections` | Source status, last-sync, record counts |
| POST | `/api/connections/{kind}/sync` | Run a provider's sync |
| POST | `/api/connections/garmin/import` | Upload Garmin export CSVs → ingest |
| GET  | `/api/workouts` | Recent workouts |
| GET  | `/api/music/recent` | Recently played |
| GET  | `/api/calendar/upcoming?days=14` | Upcoming events |
| GET  | `/api/food/search?q=…&country=ie` | Normalized food search (Open Food Facts + USDA proxy) |
| GET  | `/api/nutrition/day?date=YYYY-MM-DD` | A day's food entries (grouped by meal) + totals + targets |
| POST/PUT/DELETE | `/api/nutrition/entries[/{id}]` | Log / edit / delete a food item (recomputes the day's macro rollup) |
| GET  | `/api/habits` | Habits + 30-day completion + done-today |
| GET  | `/api/habits/heatmap?days=182` | Completed dates per habit (contribution grid) |
| POST | `/api/habits/{id}/toggle` | Toggle today's habit log |
| GET/POST/PUT/DELETE | `/api/todos[/{id}]` | Long-term **tasks** CRUD (+ `/toggle`) |
| GET  | `/api/daily-todos` | Today's daily to-dos (purges older days) |
| POST | `/api/daily-todos` | Add a daily to-do for today |
| POST | `/api/daily-todos/{id}/toggle` | Toggle done |
| DELETE | `/api/daily-todos/{id}` | Remove |

## EF Core migrations

```powershell
cd api/PersonalDashboard.Api
dotnet ef migrations add <Name>
# applied automatically on app startup; or run `dotnet ef database update`
```

## Integration roadmap (reality check)

Add real syncs in order of API friendliness. Each becomes a background job
writing into the existing tables with the right `DataSource.Kind`.

1. **Google Calendar** — official REST API, clean OAuth2. Easiest.
2. **Spotify** — official Web API, OAuth2. Note: "recently played" only returns
   the last 50 tracks, so poll regularly and store.
3. **Garmin** — no easy public API. Official Health API needs partner approval;
   hobbyists use unofficial libraries (ToS risk). **Live today via file import.**
4. **Nutrition (food DB)** — **live today.** MyFitnessPal has no usable hobbyist
   API, and its real value was the food *database*, not the logging UI. So we rent
   the database from free APIs (Open Food Facts + USDA) and own a thin logging
   layer; calories-in + macros flow into the same tables (calories-out still comes
   from Garmin). See "Food search — USDA API key" above. Barcode lookup is the next
   slot-in. *(Legacy `MyFitnessPal` source kind kept for back-compat.)*

### Integration framework (built)
Sources plug in behind one interface — [`IDataProvider`](api/PersonalDashboard.Api/Integrations/IDataProvider.cs)
(`Kind`, `Mode`, `Configured`, `SyncAsync`) — wired through a sync engine and the
**`/connect` Connections page**. [`GarminImportProvider`](api/PersonalDashboard.Api/Integrations/Providers.cs)
is live (ingests Garmin Connect exports via `GarminCsvImporter`); the rest are
labelled `PendingProvider` seams. Going live = implement `IDataProvider` + flip
`Configured` — nothing else in the app changes, because every provider just
writes `MetricSample` / `CalendarEvent` / etc. rows the UI already reads.
