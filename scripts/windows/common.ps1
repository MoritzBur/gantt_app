Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-RepoRoot {
  return (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}

function Get-NpmCmd {
  $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($npmCommand) {
    return $npmCommand.Source
  }

  $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($nodeCommand) {
    $candidate = Join-Path (Split-Path $nodeCommand.Source) 'npm.cmd'
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  throw "npm.cmd was not found. Install Node.js 20 or newer from https://nodejs.org/en/download and try again."
}

function Assert-NodeVersion {
  $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $nodeCommand) {
    throw "Node.js was not found. Install Node.js 20 or newer from https://nodejs.org/en/download and run this again."
  }

  $versionText = (& $nodeCommand.Source --version).Trim()
  $version = [Version]($versionText.TrimStart('v'))
  if ($version.Major -lt 20) {
    throw "Node.js 20 or newer is required. Found $versionText."
  }
}

function Invoke-Npm {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  $repoRoot = Get-RepoRoot
  $npmCmd = Get-NpmCmd
  Write-Host "Running: npm $($Arguments -join ' ')" -ForegroundColor Cyan
  Push-Location $repoRoot
  try {
    & $npmCmd @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "npm $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
    }
  }
  finally {
    Pop-Location
  }
}

function New-RandomSecret {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Ensure-EnvFile {
  $repoRoot = Get-RepoRoot
  $envPath = Join-Path $repoRoot '.env'
  $examplePath = Join-Path $repoRoot '.env.example'
  $dataDir = Join-Path $env:LOCALAPPDATA 'ActualPlan\data'
  $created = $false

  if (-not (Test-Path $envPath)) {
    Copy-Item $examplePath $envPath
    $created = $true
  }

  $content = Get-Content $envPath -Raw
  $updated = $false

  if ($content -match '(?m)^SESSION_SECRET=(|change-this-to-any-long-random-string)\s*$') {
    $content = [regex]::Replace(
      $content,
      '(?m)^SESSION_SECRET=(|change-this-to-any-long-random-string)\s*$',
      "SESSION_SECRET=$(New-RandomSecret)"
    )
    $updated = $true
  }

  if ($content -match '(?m)^ICAL_URLS=https://calendar\.google\.com/calendar/ical/youraddress/basic\.ics\s*$') {
    $content = [regex]::Replace(
      $content,
      '(?m)^ICAL_URLS=https://calendar\.google\.com/calendar/ical/youraddress/basic\.ics\s*$',
      'ICAL_URLS='
    )
    $updated = $true
  }

  if ($content -match '(?m)^# GANTT_DATA_DIR=/absolute/path/to/private/actual_plan_data\s*$') {
    $escapedDataDir = [regex]::Escape($dataDir)
    if ($content -notmatch "(?m)^GANTT_DATA_DIR=$escapedDataDir\s*$") {
      $content = [regex]::Replace(
        $content,
        '(?m)^# GANTT_DATA_DIR=/absolute/path/to/private/actual_plan_data\s*$',
        "GANTT_DATA_DIR=$dataDir"
      )
      $updated = $true
    }
  } elseif ($content -notmatch '(?m)^GANTT_DATA_DIR=') {
    $content = $content.TrimEnd() + [Environment]::NewLine + [Environment]::NewLine + "GANTT_DATA_DIR=$dataDir" + [Environment]::NewLine
    $updated = $true
  }

  if ($updated) {
    Set-Content -Path $envPath -Value $content -Encoding UTF8
  }

  New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

  return [PSCustomObject]@{
    EnvPath = $envPath
    DataDir = $dataDir
    Created = $created
  }
}

function Get-AppPort {
  $repoRoot = Get-RepoRoot
  $envPath = Join-Path $repoRoot '.env'
  if (-not (Test-Path $envPath)) {
    return 3000
  }

  $match = Select-String -Path $envPath -Pattern '^\s*PORT=(\d+)\s*$' | Select-Object -First 1
  if ($match) {
    return [int]$match.Matches[0].Groups[1].Value
  }

  return 3000
}

function Test-AppReady {
  param(
    [Parameter(Mandatory = $true)]
    [int]$Port
  )

  try {
    $response = Invoke-WebRequest -Uri "http://localhost:$Port/api/calendar/status" -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -eq 200
  }
  catch {
    return $false
  }
}

function Get-BuildStampTime {
  $repoRoot = Get-RepoRoot
  $distIndex = Join-Path $repoRoot 'client\dist\index.html'
  if (-not (Test-Path $distIndex)) {
    return $null
  }

  return (Get-Item $distIndex).LastWriteTimeUtc
}

function Test-BuildRequired {
  $repoRoot = Get-RepoRoot
  $buildStamp = Get-BuildStampTime
  if (-not $buildStamp) {
    return $true
  }

  $sourcePaths = @(
    (Join-Path $repoRoot 'client\src'),
    (Join-Path $repoRoot 'client\index.html'),
    (Join-Path $repoRoot 'client\vite.config.js'),
    (Join-Path $repoRoot 'package.json'),
    (Join-Path $repoRoot 'package-lock.json')
  )

  foreach ($path in $sourcePaths) {
    if (-not (Test-Path $path)) {
      continue
    }

    $item = Get-Item $path
    $items = if ($item -is [System.IO.DirectoryInfo]) {
      Get-ChildItem $path -File -Recurse
    } else {
      $item
    }

    foreach ($candidate in $items) {
      if ($candidate.LastWriteTimeUtc -gt $buildStamp) {
        return $true
      }
    }
  }

  return $false
}
