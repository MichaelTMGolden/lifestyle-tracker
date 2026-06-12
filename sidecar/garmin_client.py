"""Garmin Connect → dashboard metric samples.

Shared pull logic used by the sidecar service. Signs in with the community
`garminconnect` library and maps each day's stats/sleep/weight onto the
dashboard's metric keys. Returns a flat list of {key, at, value, unit} dicts —
the same shape the .NET /api/ingest/metrics endpoint upserts.
"""
from __future__ import annotations
import datetime as dt
import os

# garminconnect is imported lazily inside _connect so fake-mode (wiring tests)
# works without it installed.


def _at(day: dt.date) -> str:
    return dt.datetime(day.year, day.month, day.day, 12, 0, 0, tzinfo=dt.timezone.utc).isoformat()


def _first(d, *keys):
    if not d:
        return None
    for k in keys:
        v = d.get(k)
        if v is not None:
            return v
    return None


def _add(out, key, day, value, unit):
    if value is None:
        return
    try:
        out.append({"key": key, "at": _at(day), "value": float(value), "unit": unit})
    except (TypeError, ValueError):
        pass


def _connect(email: str, password: str):
    from garminconnect import Garmin  # lazy — only needed for a real pull
    token_dir = os.environ.get("GARMINTOKENS", "/tmp/garmintokens")
    # Resume a cached token first (no password / MFA prompt on warm starts).
    try:
        api = Garmin()
        api.login(token_dir)
        return api
    except Exception:
        pass
    api = Garmin(email=email, password=password)
    api.login()
    try:
        api.garth.dump(token_dir)
    except Exception:
        pass
    return api


def _collect_day(api: Garmin, day: dt.date, out: list):
    ds = day.isoformat()
    try:
        stats = api.get_stats(ds) or {}
    except Exception:
        stats = {}
    _add(out, "steps", day, _first(stats, "totalSteps"), "steps")
    _add(out, "resting_hr", day, _first(stats, "restingHeartRate"), "bpm")
    _add(out, "max_hr", day, _first(stats, "maxHeartRate"), "bpm")
    _add(out, "min_hr", day, _first(stats, "minHeartRate"), "bpm")
    _add(out, "active_calories", day, _first(stats, "activeKilocalories", "activeCalories"), "kcal")
    dist = _first(stats, "totalDistanceMeters")
    _add(out, "distance_km", day, (dist / 1000.0) if dist is not None else None, "km")
    _add(out, "floors", day, _first(stats, "floorsAscended", "floorsAscendedStairs"), "floors")
    _add(out, "stress_avg", day, _first(stats, "averageStressLevel"), "level")
    hs = _first(stats, "highStressDuration")
    _add(out, "stress_high_min", day, (hs / 60.0) if hs else None, "min")

    try:
        sleep = api.get_sleep_data(ds) or {}
    except Exception:
        sleep = {}
    dto = sleep.get("dailySleepDTO") or {}
    secs = lambda v: (v / 60.0) if v is not None else None
    _add(out, "sleep_total_min", day, secs(_first(dto, "sleepTimeSeconds")), "min")
    _add(out, "sleep_deep_min", day, secs(_first(dto, "deepSleepSeconds")), "min")
    _add(out, "sleep_light_min", day, secs(_first(dto, "lightSleepSeconds")), "min")
    _add(out, "sleep_rem_min", day, secs(_first(dto, "remSleepSeconds")), "min")
    _add(out, "sleep_awake_min", day, secs(_first(dto, "awakeSleepSeconds")), "min")
    overall = (dto.get("sleepScores") or {}).get("overall") or {}
    _add(out, "sleep_score", day, overall.get("value"), "score")


def _collect_weight(api: Garmin, start: dt.date, end: dt.date, out: list):
    try:
        body = api.get_body_composition(start.isoformat(), end.isoformat()) or {}
    except Exception:
        return
    for entry in body.get("dateWeightList") or []:
        grams = entry.get("weight")
        cal = entry.get("calendarDate") or entry.get("date")
        if grams and cal:
            try:
                _add(out, "weight_kg", dt.date.fromisoformat(str(cal)[:10]), grams / 1000.0, "kg")
            except ValueError:
                pass


def _fake(start: dt.date, end: dt.date) -> list:
    """Deterministic synthetic data for wiring tests (no Garmin login)."""
    out: list = []
    day = start
    i = 0
    while day <= end:
        _add(out, "steps", day, 8000 + (i % 5) * 600, "steps")
        _add(out, "resting_hr", day, 52 + (i % 4), "bpm")
        _add(out, "sleep_total_min", day, 420 + (i % 3) * 20, "min")
        _add(out, "sleep_score", day, 78 + (i % 5), "score")
        day += dt.timedelta(days=1)
        i += 1
    return out


def pull(email: str, password: str, days: int = 14, end: str | None = None) -> list:
    end_date = dt.date.fromisoformat(end) if end else dt.date.today()
    start_date = end_date - dt.timedelta(days=max(0, days - 1))

    if os.environ.get("SIDECAR_FAKE") == "1" or password == "__fake__":
        return _fake(start_date, end_date)

    api = _connect(email, password)
    out: list = []
    day = start_date
    while day <= end_date:
        _collect_day(api, day, out)
        day += dt.timedelta(days=1)
    _collect_weight(api, start_date, end_date, out)
    return out
