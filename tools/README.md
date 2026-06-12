# Garmin sync

`garmin_sync.py` pulls your real Garmin Connect data and pushes it into the
dashboard. Garmin has no official hobbyist API, so it uses the community
[`garminconnect`](https://github.com/cyberjunky/python-garminconnect) library
(it signs in to Garmin Connect and caches an auth token), maps each day onto the
dashboard's metric keys, and POSTs them to the app's idempotent
`/api/ingest/metrics` endpoint. Re-running over overlapping days **updates**
rows rather than duplicating them.

## Setup

```bash
pip install -r tools/requirements.txt
```

Set the environment variables (Windows `set`, macOS/Linux `export`):

| Variable             | Needed when                          | Example |
|----------------------|--------------------------------------|---------|
| `GARMIN_EMAIL`       | first login only (token is cached)   | `you@example.com` |
| `GARMIN_PASSWORD`    | first login only                     | `…` |
| `DASHBOARD_URL`      | always                               | `https://your-app.onrender.com` (or `http://localhost:5080`) |
| `DASHBOARD_PASSWORD` | if `APP_PASSWORD` is set on the app  | your shared password |
| `GARMINTOKENS`       | optional — token cache dir           | defaults to `~/.garminconnect` |

## First real sync — drop the placeholder

The app ships with a placeholder Garmin seed (`Garmin (sample)`, or
`Garmin (imported)` if you used the CSV import). Since the dashboard aggregates
metrics across all sources, leaving it in place would double-count against your
real data. On your **first** real sync, clear it (this removes both names):

```bash
python tools/garmin_sync.py --days 90 --clear-placeholder
```

That deletes the placeholder once; afterwards run without the flag.

## Run

```bash
# Pull the last 30 days and push them
python tools/garmin_sync.py --days 30

# Preview what would be sent, without pushing
python tools/garmin_sync.py --days 7 --dry-run

# Dump the payload to a file for inspection
python tools/garmin_sync.py --days 7 --out samples.json --dry-run

# Backfill a specific window
python tools/garmin_sync.py --end 2026-05-31 --days 90
```

The **first** run signs in with your email/password (and prompts for an MFA code
if you have two-factor enabled), then caches a token under `GARMINTOKENS`.
After that, runs reuse the token — no password, no MFA.

## Keeping it fresh

Schedule a small nightly pull so the dashboard stays current:

- **macOS/Linux (cron):** `0 6 * * * cd /path/to/repo && python tools/garmin_sync.py --days 3`
- **Windows (Task Scheduler):** run `python tools\garmin_sync.py --days 3` daily.

A few-day window each night covers Garmin backfilling late-arriving data (e.g.
sleep finalising) without re-pulling everything.

## Metrics synced

`steps`, `resting_hr`, `min_hr`, `max_hr`, `active_calories`, `distance_km`,
`floors`, `stress_avg`, `stress_high_min`, `sleep_total_min`, `sleep_deep_min`,
`sleep_light_min`, `sleep_rem_min`, `sleep_awake_min`, `sleep_score`, and
`weight_kg`. Missing signals on a given day are simply skipped. Everything lands
under a `Garmin (live)` data source, separate from the sample `Garmin (imported)`
data, so you can tell real data from the placeholder seed.

> Personal use only: this signs in to Garmin Connect with your own account,
> which is outside Garmin's official API terms. Fine for a single-user
> dashboard — just don't share your token cache.
