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

# ---- 3. runtime: API serves the SPA from wwwroot ----
FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS final
WORKDIR /app
COPY --from=api /app/publish ./
COPY --from=web /web/dist ./wwwroot
ENV ASPNETCORE_ENVIRONMENT=Production
EXPOSE 10000
ENTRYPOINT ["dotnet", "PersonalDashboard.Api.dll"]
