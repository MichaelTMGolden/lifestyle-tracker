#!/usr/bin/env python3
"""
Pull real Garmin Connect data and push it into the dashboard.

Garmin has no official hobbyist API, so this uses the community `garminconnect`
library (which signs in to Garmin Connect on your behalf and caches an auth
token). It maps each day's stats + sleep + weight onto the dashboard's metric
keys and POSTs them to the app's idempotent ingest endpoint, so re-running it
over overlapping days updates rows instead of duplicating them.

Quick start
-----------
    pip install -r tools/requirements.txt

    # Garmin credentials (only needed for the FIRST login — a token is cached after)
    set GARMIN_EMAIL=you@example.com
    set GARMIN_PASSWORD=...

    # Where to send the data, and the shared password if APP_PASSWORD is set on it
    set DASHBOARD_URL=https://your-app.onrender.com      # or http://localhost:5080
    set DASHBOARD_PASSWORD=...                            # omit if no APP_PASSWORD

    python tools/garmin_sync.py --days 30

Re-run any time to refresh (a cron job / Task Scheduler entry works well —
e.g. `python tools/garmin_sync.py --days 3` nightly). Use --dry-run to preview
the samples without sending them, or --out samples.json to inspect the payload.

Note: this signs in to Garmin Connect with your own account for personal use.
That's outside Garmin's official API terms; it's the standard community route
and fine for a single-user dashboard, but don't share your token cache.
"""
from __future__ import annotations
import argparse
import datetime as dt
import os
import sys

try:
    import requests
    from garminconnect import Garmin
except ImportError:
    sys.exit("Missing deps. Run:  pip install -r tools/requirements.txt")


# ---- Garmin auth (token-cached so MFA / password is only needed once) ----
def connect_garmin() -> Garmin:
    token_dir = os.environ.get("GARMINTOKENS", os.path.expanduser("~/.garminconnect"))
    # Resume from a cached token if we have one — no password, no MFA prompt.
    try:
        api = Garmin()
        api.login(token_dir)
        return api
    except Exception:
        pass

    email = os.environ.get("GARMIN_EMAIL")
    password = os.environ.get("GARMIN_PASSWORD")
    if not email or not password:
        sys.exit("No cached Garmin token and GARMIN_EMAIL / GARMIN_PASSWORD are not set.")
    api = Garmin(email=email, password=password)
    api.login()  # if MFA is enabled, garth prompts for the code on this first interactive run
    try:
        api.garth.dump(token_dir)
        print(f"Saved Garmin auth token to {token_dir} (future runs won't need the password).")
    except Exception:
        pass
    return api


# ---- helpers ----
def first(d: dict | None, *keys):
    """First present, non-None value among keys (dicts vary by Garmin account)."""
    if not d:
        return None
    for k in keys:
        v = d.get(k)
        if v is not None:
            return v
    return None


def at(day: dt.date) -> str:
    """Stable timestamp for a day's samples: noon UTC (keeps each day's row unique)."""
    return dt.datetime(day.year, day.month, day.day, 12, 0, 0, tzinfo=dt.timezone.utc).isoformat()


def sample(out: list, key: str, day: dt.date, value, unit: str):
    if value is None:
        return
    try:
        out.append({"key": key, "at": at(day), "value": float(value), "unit": unit})
    except (TypeError, ValueError):
        pass


def collect_day(api: Garmin, day: dt.date, out: list):
    ds = day.isoformat()

    # Daily activity + heart-rate + stress summary.
    try:
        stats = api.get_stats(ds)
    except Exception as e:
        print(f"  {ds}: stats unavailable ({e})")
        stats = {}
    sample(out, "steps", day, first(stats, "totalSteps"), "steps")
    sample(out, "resting_hr", day, first(stats, "restingHeartRate"), "bpm")
    sample(out, "max_hr", day, first(stats, "maxHeartRate"), "bpm")
    sample(out, "min_hr", day, first(stats, "minHeartRate"), "bpm")
    sample(out, "active_calories", day, first(stats, "activeKilocalories", "activeCalories"), "kcal")
    dist_m = first(stats, "totalDistanceMeters")
    sample(out, "distance_km", day, (dist_m / 1000.0) if dist_m is not None else None, "km")
    sample(out, "floors", day, first(stats, "floorsAscended", "floorsAscendedStairs"), "floors")
    sample(out, "stress_avg", day, first(stats, "averageStressLevel"), "level")
    high_stress_s = first(stats, "highStressDuration")
    sample(out, "stress_high_min", day, (high_stress_s / 60.0) if high_stress_s else None, "min")

    # Sleep (durations are seconds; score lives under sleepScores.overall).
    try:
        sleep = api.get_sleep_data(ds) or {}
    except Exception:
        sleep = {}
    dto = sleep.get("dailySleepDTO") or {}
    secs = lambda v: (v / 60.0) if v is not None else None
    sample(out, "sleep_total_min", day, secs(first(dto, "sleepTimeSeconds")), "min")
    sample(out, "sleep_deep_min", day, secs(first(dto, "deepSleepSeconds")), "min")
    sample(out, "sleep_light_min", day, secs(first(dto, "lightSleepSeconds")), "min")
    sample(out, "sleep_rem_min", day, secs(first(dto, "remSleepSeconds")), "min")
    sample(out, "sleep_awake_min", day, secs(first(dto, "awakeSleepSeconds")), "min")
    scores = dto.get("sleepScores") or {}
    overall = scores.get("overall") or {}
    sample(out, "sleep_score", day, overall.get("value"), "score")


def collect_weight(api: Garmin, start: dt.date, end: dt.date, out: list):
    try:
        body = api.get_body_composition(start.isoformat(), end.isoformat()) or {}
    except Exception:
        return
    for entry in body.get("dateWeightList") or []:
        grams = entry.get("weight")
        cal = entry.get("calendarDate") or entry.get("date")
        if grams and cal:
            try:
                day = dt.date.fromisoformat(str(cal)[:10])
                sample(out, "weight_kg", day, grams / 1000.0, "kg")
            except ValueError:
                pass


# ---- push to the dashboard ----
def push(samples: list, base_url: str, password: str | None, source: str, clear_placeholder: bool):
    s = requests.Session()
    if password:
        r = s.post(f"{base_url}/api/auth/login", json={"password": password}, timeout=30)
        if r.status_code != 200:
            sys.exit(f"Dashboard login failed ({r.status_code}). Check DASHBOARD_PASSWORD.")
    if clear_placeholder:
        # The placeholder seed is named "Garmin (sample)" (dummy seed) or
        # "Garmin (imported)" (CSV import) depending on how it got there.
        for name in ("Garmin (sample)", "Garmin (imported)"):
            r = s.delete(f"{base_url}/api/ingest/source/{name}", params={"kind": "Garmin"}, timeout=60)
            if r.status_code == 200 and r.json().get("deleted"):
                print(f"Cleared placeholder seed: {r.json()}")
    r = s.post(f"{base_url}/api/ingest/metrics",
               json={"source": source, "kind": "Garmin", "samples": samples}, timeout=120)
    if r.status_code != 200:
        sys.exit(f"Ingest failed ({r.status_code}): {r.text[:300]}")
    print(f"Pushed {len(samples)} samples → {base_url} ({r.json()})")


def main():
    p = argparse.ArgumentParser(description="Sync Garmin Connect data into the dashboard.")
    p.add_argument("--days", type=int, default=14, help="how many days back from --end to pull (default 14)")
    p.add_argument("--end", default=None, help="last day to pull, YYYY-MM-DD (default: today)")
    p.add_argument("--source", default="Garmin (live)", help="DataSource name to ingest under")
    p.add_argument("--dry-run", action="store_true", help="collect + print a summary, don't push")
    p.add_argument("--out", default=None, help="also write the collected samples to this JSON file")
    p.add_argument("--clear-placeholder", action="store_true",
                   help="delete the seeded 'Garmin (imported)' placeholder before pushing (run once on first real sync)")
    args = p.parse_args()

    end = dt.date.fromisoformat(args.end) if args.end else dt.date.today()
    start = end - dt.timedelta(days=max(0, args.days - 1))

    api = connect_garmin()
    print(f"Collecting Garmin data {start} … {end}")

    samples: list = []
    day = start
    while day <= end:
        collect_day(api, day, samples)
        day += dt.timedelta(days=1)
    collect_weight(api, start, end, samples)

    by_key: dict[str, int] = {}
    for s in samples:
        by_key[s["key"]] = by_key.get(s["key"], 0) + 1
    print(f"Collected {len(samples)} samples across {len(by_key)} metrics:")
    for k in sorted(by_key):
        print(f"  {k:18} {by_key[k]}")

    if args.out:
        import json
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(samples, f, indent=2)
        print(f"Wrote {args.out}")

    if args.dry_run:
        print("Dry run — nothing pushed.")
        return
    if not samples:
        print("No samples collected; nothing to push.")
        return

    base_url = os.environ.get("DASHBOARD_URL", "http://localhost:5080").rstrip("/")
    push(samples, base_url, os.environ.get("DASHBOARD_PASSWORD"), args.source, args.clear_placeholder)


if __name__ == "__main__":
    main()
