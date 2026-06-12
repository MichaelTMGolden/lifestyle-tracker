# syntax=docker/dockerfile:1

# ---- 1. build the React front-end ----
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package*.json ./
# npm install (not ci) so the build is resilient to lockfile/platform drift
# between your machine and the Linux build image (optional native deps differ).
RUN npm install --no-audit --no-fund
COPY web/ ./
RUN npm run build            # -> /web/dist

# ---- 2. publish the .NET API ----
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS api
WORKDIR /src
COPY api/PersonalDashboard.Api/PersonalDashboard.Api.csproj api/PersonalDashboard.Api/
RUN dotnet restore api/PersonalDashboard.Api/PersonalDashboard.Api.csproj
COPY api/PersonalDashboard.Api/ api/PersonalDashboard.Api/
RUN dotnet publish api/PersonalDashboard.Api/PersonalDashboard.Api.csproj -c Release -o /app/publish

# ---- 3. runtime: API serves the SPA + runs the Python Garmin sidecar ----
FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS final
WORKDIR /app

# Python + the sidecar's deps in an isolated venv. Garmin has no server-usable
# API, so the scrape runs here in-process and the .NET app calls it on
# localhost:8001 (started by entrypoint.sh).
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*
COPY sidecar/ ./sidecar/
RUN python3 -m venv /opt/sidecar-venv \
    && /opt/sidecar-venv/bin/pip install --no-cache-dir -r ./sidecar/requirements.txt

COPY --from=api /app/publish ./
COPY --from=web /web/dist ./wwwroot
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

ENV ASPNETCORE_ENVIRONMENT=Production
EXPOSE 10000
ENTRYPOINT ["./entrypoint.sh"]
