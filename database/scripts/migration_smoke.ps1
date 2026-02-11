param(
  [string]$PsqlPath = "psql",
  [string]$DbHost = $env:PGHOST,
  [string]$DbPort = $env:PGPORT,
  [string]$DbName = $env:PGDATABASE,
  [string]$DbUser = $env:PGUSER
)

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$backendEnvPath = Join-Path $repoRoot "backend\\.env"

if ((-not $DbHost -or -not $DbPort -or -not $DbName -or -not $DbUser) -and (Test-Path $backendEnvPath)) {
  Get-Content $backendEnvPath | ForEach-Object {
    if ($_ -match '^[A-Za-z_][A-Za-z0-9_]*=') {
      $k, $v = $_ -split '=', 2
      if (-not (Get-Item "Env:$k" -ErrorAction SilentlyContinue)) {
        Set-Item -Path "Env:$k" -Value $v
      }
    }
  }
  if (-not $DbHost) { $DbHost = $env:PGHOST }
  if (-not $DbPort) { $DbPort = $env:PGPORT }
  if (-not $DbName) { $DbName = $env:PGDATABASE }
  if (-not $DbUser) { $DbUser = $env:PGUSER }
}

if (-not $DbHost) { $DbHost = "localhost" }
if (-not $DbPort) { $DbPort = "5432" }
if (-not $DbName) {
  Write-Error "PGDATABASE is required"
  exit 1
}
if (-not $DbUser) {
  Write-Error "PGUSER is required"
  exit 1
}

$migrationsDir = Join-Path $repoRoot "database\\migrations"
$migrationFiles = Get-ChildItem -Path $migrationsDir -Filter "*.sql" |
  Where-Object {
    $parts = $_.BaseName.Split('_', 2)
    if ($parts.Count -lt 1) { return $false }
    $num = 0
    $parsed = [int]::TryParse($parts[0], [ref]$num)
    return $parsed -and $num -ge 5
  } |
  Sort-Object Name

if ($migrationFiles.Count -eq 0) {
  Write-Error "No migration files found in $migrationsDir"
  exit 1
}

if ($PsqlPath -eq "psql") {
  $psqlCmd = Get-Command psql -ErrorAction SilentlyContinue
  if ($psqlCmd) {
    $PsqlPath = $psqlCmd.Source
  } else {
    $candidates = @(
      "C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe",
      "C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe",
      "C:\\Program Files\\PostgreSQL\\16\\bin\\psql.exe",
      "C:\\Program Files\\PostgreSQL\\15\\bin\\psql.exe"
    )
    $found = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($found) {
      $PsqlPath = $found
    }
  }
}

if (-not (Test-Path $PsqlPath)) {
  Write-Error "psql executable not found. Set -PsqlPath explicitly."
  exit 1
}

Write-Host "Applying migrations to ${DbName}@${DbHost}:${DbPort} as ${DbUser}"
foreach ($migration in $migrationFiles) {
  Write-Host ">> $($migration.Name)"
  & $PsqlPath -h $DbHost -p $DbPort -U $DbUser -d $DbName -v ON_ERROR_STOP=1 -f $migration.FullName
  if ($LASTEXITCODE -ne 0) {
    Write-Error "Migration failed: $($migration.Name)"
    exit $LASTEXITCODE
  }
}

Write-Host "Migration smoke run completed successfully."
