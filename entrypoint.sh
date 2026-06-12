#!/usr/bin/env bash
set -e

# Start the Python Garmin sidecar (in-container) if it's present, then run the API.
# The .NET app talks to it on localhost:8001 (SIDECAR_URL override respected).
if [ -d /app/sidecar ]; then
  echo "Starting Garmin sidecar on :8001…"
  GARMINTOKENS=/tmp/garmintokens \
  /opt/sidecar-venv/bin/uvicorn app:app --app-dir /app/sidecar --host 127.0.0.1 --port 8001 \
    > /tmp/sidecar.log 2>&1 &
fi

exec dotnet PersonalDashboard.Api.dll
