<#
.SYNOPSIS
  Take a full backup of the live database into ./backups (git-ignored).

.DESCRIPTION
  Runs pg_dump in the postgres:18 Docker image and writes a custom-format dump
  (restore it with restore-drill.ps1 or pg_restore). The dump is checked by
  listing its contents before old backups are pruned, so a bad dump never
  replaces good ones.

  The database URL is read from -DatabaseUrl or the DATABASE_URL environment
  variable. Use Render's *External* Database URL (dashboard-db -> Connect).
  It is passed to the container as an environment variable, not on the command
  line, and never written to disk.

.EXAMPLE
  $env:DATABASE_URL = '<External Database URL from Render>'
  ./tools/db/backup.ps1
#>
param(
    [string]$DatabaseUrl = $env:DATABASE_URL,
    [string]$OutDir = (Join-Path $PSScriptRoot '..\..\backups'),
    [int]$Keep = 14
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

if (-not $DatabaseUrl) { throw 'Set DATABASE_URL (or pass -DatabaseUrl) to the External Database URL from Render.' }
Assert-Docker

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path
# Seconds plus a random suffix: two runs can never target the same file. The dump
# is written under a .partial name and only renamed once it has been verified,
# so an interrupted or bad dump never replaces or shadows a good backup.
$name = 'dashboard-' + (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd_HHmmss') + 'Z-' +
    [guid]::NewGuid().ToString('N').Substring(0, 6) + '.dump'
$partial = "$name.partial"
$partialPath = Join-Path $OutDir $partial

$env:PD_BACKUP_URL = $DatabaseUrl
try {
    Invoke-Native 'pg_dump' {
        docker run --rm -e PD_BACKUP_URL -v "${OutDir}:/backup" $script:PgImage `
            sh -c "pg_dump --format=custom --no-owner --no-privileges --file=/backup/$partial `"`$PD_BACKUP_URL`""
    }

    # Sanity check: the dump must be readable and contain table data.
    $entries = Invoke-Native 'Reading the new dump' { docker run --rm -v "${OutDir}:/backup" $script:PgImage pg_restore --list "/backup/$partial" }
    if (-not $entries) { throw "The new dump is unreadable; older backups were left alone." }
    $tables = @($entries | Where-Object { $_ -match ' TABLE DATA ' }).Count
    if ($tables -eq 0) { throw "The new dump has no table data; older backups were left alone." }

    Rename-Item -LiteralPath $partialPath -NewName $name
} finally {
    Remove-Item Env:\PD_BACKUP_URL -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $partialPath) { Remove-Item -LiteralPath $partialPath -ErrorAction SilentlyContinue }
}

$file = Get-Item -LiteralPath (Join-Path $OutDir $name)
Write-Host ("Backup written: {0} ({1:N1} MB, {2} tables)" -f $file.FullName, ($file.Length / 1MB), $tables)

# Keep the newest $Keep dumps.
Get-ChildItem $OutDir -Filter 'dashboard-*.dump' |
    Where-Object { $_.Extension -eq '.dump' } |
    Sort-Object Name -Descending |
    Select-Object -Skip $Keep |
    ForEach-Object { Write-Host "Pruning old backup $($_.Name)"; Remove-Item $_.FullName }
