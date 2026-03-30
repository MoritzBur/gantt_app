param()

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
$EnvExampleFile = Join-Path $RepoRoot ".env.example"

Write-Step "Checking prerequisites..."

Require-Command "node" "Node.js 20 or newer is required. Install it from https://nodejs.org/ and rerun this script."
Require-Command "npm" "npm is required. Install Node.js from https://nodejs.org/ and rerun this script."

$NodeVersion = (& node -v).Trim()
$NodeMajor = [int]((& node -p "process.versions.node.split('.')[0]").Trim())
if ($NodeMajor -lt 20) {
  Fail "Detected Node.js $NodeVersion. This project expects Node.js 20 or newer."
}

Write-Step "Node: $NodeVersion"
Write-Step "npm:  $((& npm -v).Trim())"
Write-Step ""
Write-Step "Installing dependencies with npm..."
Push-Location $RepoRoot
try {
  & npm install
} finally {
  Pop-Location
}

Write-Step ""
if (-not (Test-Path $EnvFile)) {
  Copy-Item $EnvExampleFile $EnvFile
  Write-Step "Created .env from .env.example."
} else {
  Write-Step "Found existing .env."
}

$SessionSecret = Get-EnvValue $EnvFile "SESSION_SECRET"
if ([string]::IsNullOrWhiteSpace($SessionSecret)) {
  Write-Step "Reminder: set SESSION_SECRET in .env before starting the app."
} elseif ($SessionSecret -eq "change-this-to-any-long-random-string") {
  Write-Step "Reminder: replace the example SESSION_SECRET in .env with your own random string."
}

$DataDir = Get-EnvValue $EnvFile "GANTT_DATA_DIR"
if ([string]::IsNullOrWhiteSpace($DataDir)) {
  Write-Step "GANTT_DATA_DIR is not set. The app will store local data in .\data by default."
} else {
  Write-Step "GANTT_DATA_DIR is set to: $DataDir"
}

Write-Step ""
if (Get-Command git -ErrorAction SilentlyContinue) {
  Write-Step "Git:  $((& git --version).Trim())"
  Write-Step "Basic planning works without Git expertise."
  Write-Step "If your data directory is a Git repo, the History panel can save Git-backed snapshots."
} else {
  Write-Step "Git was not found on PATH."
  Write-Step "Basic planning still works, but Git-backed snapshot/history workflows need Git installed."
}

Write-Step ""
Write-Step "Setup complete."
Write-Step "Start the app with .\launch-windows.cmd"
Write-Step "If you want a desktop shortcut, run powershell -ExecutionPolicy Bypass -File .\create-windows-shortcut.ps1"
