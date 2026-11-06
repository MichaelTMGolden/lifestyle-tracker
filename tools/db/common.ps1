# Shared helpers for the database safety scripts. Dot-source it; don't run it.
# Everything runs inside the official postgres Docker image, so no local
# Postgres install is needed. Render's database is Postgres 18, and pg_dump must
# be at least the server's version, hence postgres:18.

$script:PgImage = 'postgres:18'

function Invoke-Native {
    # Run a native command and stop on a non-zero exit (PowerShell 5.1 doesn't).
    # Native tools write progress to stderr; under Windows PowerShell 5.1 with
    # ErrorActionPreference=Stop that alone would throw, so judge by exit code.
    param([Parameter(Mandatory)][string]$What, [Parameter(Mandatory)][scriptblock]$Command)
    $ErrorActionPreference = 'Continue'
    & $Command
    if ($LASTEXITCODE -ne 0) { throw "$What failed (exit code $LASTEXITCODE)." }
}

function Remove-Container {
    param([Parameter(Mandatory)][string]$Name)
    $ErrorActionPreference = 'Continue'
    # --volumes: the postgres image declares a VOLUME; without it every drill would
    # leave an anonymous volume holding a full restored copy of the data.
    docker rm -f --volumes $Name 2>&1 | Out-Null
}

function Assert-Docker {
    $ErrorActionPreference = 'Continue'
    docker info --format '{{.ServerVersion}}' 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Docker is not running. Start Docker Desktop and try again.' }
}

# Exact row count of every table in the public schema of a database inside a
# running container. Returns an ordered hashtable: table name -> count.
function Get-RowCounts {
    param([Parameter(Mandatory)][string]$Container, [Parameter(Mandatory)][string]$Database)
    $ErrorActionPreference = 'Continue'
    $sql = @'
SELECT table_name || '|' ||
       (xpath('/row/c/text()',
              query_to_xml(format('SELECT count(*) AS c FROM public.%I', table_name), false, true, '')))[1]::text
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;
'@
    $tmp = [System.IO.Path]::GetTempFileName()
    try {
        [System.IO.File]::WriteAllText($tmp, $sql)
        Invoke-Native 'Copying the count query' { docker cp $tmp "${Container}:/tmp/rowcounts.sql" | Out-Null }
        $lines = docker exec $Container psql -U postgres -d $Database -At -f /tmp/rowcounts.sql
        if ($LASTEXITCODE -ne 0) { throw 'Counting rows failed.' }
    } finally { Remove-Item $tmp -ErrorAction SilentlyContinue }

    $counts = [ordered]@{}
    foreach ($line in $lines) {
        if (-not $line) { continue }
        $name, $n = $line -split '\|', 2
        $counts[$name] = [long]$n
    }
    return $counts
}

function Wait-Postgres {
    param([Parameter(Mandatory)][string]$Container)
    $ErrorActionPreference = 'Continue'
    for ($i = 0; $i -lt 60; $i++) {
        docker exec $Container pg_isready -U postgres -q 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { return }
        Start-Sleep -Seconds 1
    }
    throw "Postgres in '$Container' did not become ready."
}
