#!/usr/bin/env bash
set -e

# One-time move of the data from another Render database (the Oregon one) into
# this service's database. Runs only when COPY_FROM_HOST is set (render.yaml
# fills it, and the rest, from the old database, so no credential is typed
# anywhere) and only while this database has no app tables yet. The restore is
# a single transaction: it lands completely or not at all, and a failure stops
# the deploy instead of starting the app on a half-copied database.
copy_from_old_database() {
  [ -n "${COPY_FROM_HOST:-}" ] || return 0
  local target="${ConnectionStrings__Postgres:?no target database}"
  if [ "$(psql "$target" -tAc "select to_regclass('public.\"Habits\"') is not null")" = "t" ]; then
    echo "copy: this database already has data; nothing to copy"
    return 0
  fi
  # Render hands over the internal host name; from another region the old
  # database is reached on its external name.
  local host="$COPY_FROM_HOST"
  case "$host" in *.*) ;; *) host="$host.${COPY_FROM_REGION:-oregon}-postgres.render.com" ;; esac
  echo "copy: dumping $COPY_FROM_DB from $host"
  PGPASSWORD="$COPY_FROM_PASSWORD" pg_dump \
    "host=$host port=${COPY_FROM_PORT:-5432} dbname=$COPY_FROM_DB user=$COPY_FROM_USER sslmode=${COPY_FROM_SSLMODE:-require}" \
    --no-owner --no-acl --format=custom --file=/tmp/move.dump
  echo "copy: restoring into this database"
  pg_restore --no-owner --no-acl --single-transaction --exit-on-error --dbname="$target" /tmp/move.dump
  rm -f /tmp/move.dump
  echo "copy: done; habits=$(psql "$target" -tAc 'select count(*) from "Habits"') habit_logs=$(psql "$target" -tAc 'select count(*) from "HabitLogs"')"
}
copy_from_old_database

# Start the Python Garmin sidecar (in-container) if it's present, then run the API.
# The .NET app talks to it on localhost:8001 (SIDECAR_URL override respected).
if [ -d /app/sidecar ]; then
  echo "Starting Garmin sidecar on :8001…"
  GARMINTOKENS=/tmp/garmintokens \
  /opt/sidecar-venv/bin/uvicorn app:app --app-dir /app/sidecar --host 127.0.0.1 --port 8001 \
    > /tmp/sidecar.log 2>&1 &
fi

exec dotnet PersonalDashboard.Api.dll
