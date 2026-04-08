param(
  [switch]$BuildProductionAssets,
  [string]$DefaultDataDir
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$Message) {
  Write-Host $Message
}

function Fail([string]$Message) {
  throw $Message
}

function Invoke-CheckedCommand([string]$FilePath, [string[]]$Arguments, [string]$FailureMessage) {
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    Fail "$FailureMessage (exit code $LASTEXITCODE)"
  }
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

function Set-EnvValue([string]$Path, [string]$Key, [string]$Value) {
  $escapedValue = [Regex]::Escape($Key)
  $content = @()
  if (Test-Path $Path) {
    $content = Get-Content $Path
  }

  $updated = $false
  for ($index = 0; $index -lt $content.Count; $index += 1) {
    if ($content[$index] -match "^\s*$escapedValue=") {
      $content[$index] = "$Key=$Value"
      $updated = $true
    }
  }

  if (-not $updated) {
    $content += "$Key=$Value"
  }

  Set-Content -Path $Path -Value $content -Encoding ascii
}

function New-SessionSecret() {
  $guidParts = 1..4 | ForEach-Object { [guid]::NewGuid().ToString("N") }
  return ($guidParts -join "")
}

function Test-LooksLikeNestedZipExtract([string]$Path) {
  $leafName = Split-Path -Leaf $Path
  $parentName = Split-Path -Leaf (Split-Path -Parent $Path)

  if ($leafName -ieq "gantt_app" -and $parentName -match '^Actual Plan(?: \(\d+\))?$') {
    return $true
  }

  return $false
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

if ($BuildProductionAssets) {
  Write-Step "Installer mode: production assets will be built during setup."
}
if (-not [string]::IsNullOrWhiteSpace($DefaultDataDir)) {
  Write-Step "Installer mode: default data directory requested at $DefaultDataDir"
}
if ($BuildProductionAssets -or -not [string]::IsNullOrWhiteSpace($DefaultDataDir)) {
  Write-Step ""
}

if (Test-LooksLikeNestedZipExtract -Path $RepoRoot) {
  Write-Step "Warning: this looks like the nested ZIP layout 'Actual Plan\\gantt_app\\...'."
  Write-Step "The app can still run here, but the cleaner fix is to move the inner gantt_app folder contents up one level or use the Windows installer."
  Write-Step ""
}

Write-Step "Installing npm dependencies... This can take a minute."
Push-Location $RepoRoot
try {
  Invoke-CheckedCommand -FilePath "npm" -Arguments @("install") -FailureMessage "npm install failed"
} finally {
  Pop-Location
}

Write-Step ""
Write-Step "Preparing local configuration..."
if (-not (Test-Path $EnvFile)) {
  Copy-Item $EnvExampleFile $EnvFile
  Write-Step "Created .env from .env.example."
} else {
  Write-Step "Found existing .env."
}

$SessionSecret = Get-EnvValue $EnvFile "SESSION_SECRET"
if ([string]::IsNullOrWhiteSpace($SessionSecret)) {
  $SessionSecret = New-SessionSecret
  Set-EnvValue -Path $EnvFile -Key "SESSION_SECRET" -Value $SessionSecret
  Write-Step "Generated SESSION_SECRET in .env."
} elseif ($SessionSecret -eq "change-this-to-any-long-random-string") {
  $SessionSecret = New-SessionSecret
  Set-EnvValue -Path $EnvFile -Key "SESSION_SECRET" -Value $SessionSecret
  Write-Step "Replaced the example SESSION_SECRET in .env with a random value."
}

if (-not [string]::IsNullOrWhiteSpace($DefaultDataDir)) {
  $ResolvedDefaultDataDir = [System.IO.Path]::GetFullPath($DefaultDataDir)
  $ConfiguredDataDir = Get-EnvValue $EnvFile "GANTT_DATA_DIR"
  if ([string]::IsNullOrWhiteSpace($ConfiguredDataDir)) {
    Set-EnvValue -Path $EnvFile -Key "GANTT_DATA_DIR" -Value $ResolvedDefaultDataDir
    Write-Step "Configured GANTT_DATA_DIR in .env."
  }

  if (-not (Test-Path $ResolvedDefaultDataDir)) {
    New-Item -ItemType Directory -Path $ResolvedDefaultDataDir -Force | Out-Null
    Write-Step "Created data directory at $ResolvedDefaultDataDir"
  }
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

if ($BuildProductionAssets) {
  Write-Step ""
  Write-Step "Building production frontend assets... This can also take a minute."
  Push-Location $RepoRoot
  try {
    Invoke-CheckedCommand -FilePath "npm" -Arguments @("run", "build") -FailureMessage "npm run build failed"
  } finally {
    Pop-Location
  }
}

Write-Step ""
Write-Step "Setup complete."
Write-Step "For everyday use, create a launcher shortcut with powershell -ExecutionPolicy Bypass -File .\create-windows-shortcut.ps1"
Write-Step "If you prefer a manual terminal launch, start the app with .\launch-windows.cmd"
Write-Step "That shortcut uses the app icon and launches Actual Plan without leaving a PowerShell window open."
