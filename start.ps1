param(
  [switch]$Production
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$Message) {
  Write-Host $Message
}

function Fail([string]$Message) {
  throw $Message
}

function Require-Command([string]$CommandName, [string]$Guidance) {
  if (-not (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
    Fail $Guidance
  }
}

function Get-EnvValue([string]$Path, [string]$Key) {
  if (-not (Test-Path $Path)) {
    return $null
  }

  $line = Get-Content $Path | Where-Object { $_ -match "^\s*$Key=" } | Select-Object -Last 1
  if (-not $line) {
    return $null
  }

  return ($line -replace "^\s*$Key=", "").Trim()
}

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$EnvFile = Join-Path $RepoRoot ".env"
$NodeModules = Join-Path $RepoRoot "node_modules"

Require-Command "node" "Node.js 20 or newer is required. Install it from https://nodejs.org/ and rerun this script."
Require-Command "npm" "npm is required. Install Node.js from https://nodejs.org/ and rerun this script."

$NodeVersion = (& node -v).Trim()
$NodeMajor = [int]((& node -p "process.versions.node.split('.')[0]").Trim())
if ($NodeMajor -lt 20) {
  Fail "Detected Node.js $NodeVersion. This project expects Node.js 20 or newer."
}

if (-not (Test-Path $NodeModules)) {
  Fail "Dependencies are not installed yet. Run setup.ps1 first."
}

if (-not (Test-Path $EnvFile)) {
  Fail "No .env file found. Run setup.ps1 first."
}

$SessionSecret = Get-EnvValue $EnvFile "SESSION_SECRET"
if ([string]::IsNullOrWhiteSpace($SessionSecret)) {
  Fail "SESSION_SECRET is missing in .env."
}

if ($SessionSecret -eq "change-this-to-any-long-random-string") {
  Write-Step "Warning: SESSION_SECRET is still using the example value in .env."
}

$Port = Get-EnvValue $EnvFile "PORT"
if ([string]::IsNullOrWhiteSpace($Port)) {
  $Port = "3000"
}

$DataDir = Get-EnvValue $EnvFile "GANTT_DATA_DIR"
if ([string]::IsNullOrWhiteSpace($DataDir)) {
  $DataDir = Join-Path $RepoRoot "data"
}

Write-Step "Starting Gantt App from $RepoRoot"
Write-Step "Data directory: $DataDir"

Push-Location $RepoRoot
try {
  if ($Production) {
    Write-Step "Mode: production"
    Write-Step "The app will be available at http://localhost:$Port"
    & npm run build
    & npm start
  } else {
    Write-Step "Mode: development"
    Write-Step "Backend:  http://localhost:$Port"
    Write-Step "Frontend: http://localhost:5173"
    Write-Step "Open the frontend URL once Vite reports that it is ready."
    & npm run dev
  }
} finally {
  Pop-Location
}
