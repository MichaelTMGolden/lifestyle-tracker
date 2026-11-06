<#
.SYNOPSIS
  Prove a backup restores, and (optionally) that pending migrations lose no rows.

.DESCRIPTION
  Restores a dump into a throwaway Postgres 18 container and prints the row
  count of every table. Nothing touches the live database.

  With -CheckMigrations it then runs the app's own startup database work
  (`dotnet run -- migrate-only`: migrations + seeding, exactly what a deploy
  does) against the restored copy and compares counts table by table. It fails
  if any table lost rows or disappeared. Run this before deploying any change
  that adds a migration.

.EXAMPLE
  ./tools/db/restore-drill.ps1 -DumpFile backups/dashboard-2026-11-06_2100Z.dump

.EXAMPLE
  ./tools/db/restore-drill.ps1 -DumpFile (Get-ChildItem backups/*.dump | Sort-Object Name | Select-Object -Last 1) -CheckMigrations
#>
param(
    [Parameter(Mandatory)][string]$DumpFile,
    [switch]$CheckMigrations,
    [switch]$KeepContainer,
    [int]$Port = 55432
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$DumpFile = (Resolve-Path $DumpFile).Path
Assert-Docker

$container = 'pd-restore-drill'
$db = 'restore'
Remove-Container $container

try {
    Write-Host "Starting a throwaway Postgres on port $Port..."
    Invoke-Native 'Starting the drill container' {
        docker run -d --name $container -e POSTGRES_PASSWORD=drill -p "${Port}:5432" $script:PgImage | Out-Null
    }
    Wait-Postgres $container
    Invoke-Native 'Creating the drill database' { docker exec $container createdb -U postgres $db }
    Invoke-Native 'Copying the dump' { docker cp $DumpFile "${container}:/tmp/restore.dump" | Out-Null }

    Write-Host "Restoring $(Split-Path $DumpFile -Leaf)..."
    Invoke-Native 'pg_restore' {
        docker exec $container pg_restore -U postgres -d $db --no-owner --no-privileges --exit-on-error /tmp/restore.dump
    }

    $before = Get-RowCounts -Container $container -Database $db
    if ($before.Count -eq 0) { throw 'The restore produced no tables.' }
    Write-Host ''
    Write-Host 'Restored rows per table:'
    $before.GetEnumerator() | ForEach-Object { '  {0,-28} {1,10:N0}' -f $_.Key, $_.Value } | Write-Host
    Write-Host ''
    Write-Host 'Restore drill passed.' -ForegroundColor Green

    if ($CheckMigrations) {
        Write-Host ''
        Write-Host 'Running the app''s startup migrations against the restored copy...'
        $project = Join-Path $PSScriptRoot '..\..\api\PersonalDashboard.Api'
        $env:ConnectionStrings__Postgres = "Host=localhost;Port=$Port;Database=$db;Username=postgres;Password=drill"
        $env:ASPNETCORE_ENVIRONMENT = 'Production'
        $env:SEED_DUMMY_DATA = 'false'
        try {
            Invoke-Native 'Applying migrations' { dotnet run --no-launch-profile --project $project -- migrate-only }
        } finally {
            Remove-Item Env:\ConnectionStrings__Postgres, Env:\ASPNETCORE_ENVIRONMENT, Env:\SEED_DUMMY_DATA -ErrorAction SilentlyContinue
        }

        $after = Get-RowCounts -Container $container -Database $db
        $lost = @()
        Write-Host ''
        Write-Host ('  {0,-28} {1,10} {2,10}' -f 'Table', 'Before', 'After')
        foreach ($table in $before.Keys) {
            $b = $before[$table]
            if (-not $after.Contains($table)) { $lost += "$table (table dropped, had $b rows)"; Write-Host ('  {0,-28} {1,10:N0} {2,10}' -f $table, $b, 'GONE') -ForegroundColor Red; continue }
            $a = $after[$table]
            $line = '  {0,-28} {1,10:N0} {2,10:N0}' -f $table, $b, $a
            if ($a -lt $b) { $lost += "$table ($b -> $a rows)"; Write-Host $line -ForegroundColor Red } else { Write-Host $line }
        }
        foreach ($table in $after.Keys) {
            if (-not $before.Contains($table)) { Write-Host ('  {0,-28} {1,10} {2,10:N0}  (new)' -f $table, '-', $after[$table]) }
        }
        Write-Host ''
        if ($lost.Count -gt 0) {
            Write-Host 'Migration check FAILED. Rows were lost in:' -ForegroundColor Red
            $lost | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
            exit 1
        }
        Write-Host 'Migration check passed: no table lost rows.' -ForegroundColor Green
    }
} finally {
    if ($KeepContainer) { Write-Host "Container '$container' left running on port $Port (password: drill)." }
    else { Remove-Container $container }
}
