. (Join-Path $PSScriptRoot 'common.ps1')

try {
  $repoRoot = Get-RepoRoot
  Assert-NodeVersion
  $envInfo = Ensure-EnvFile
  $port = Get-AppPort
  $url = "http://localhost:$port"

  if (-not (Test-Path (Join-Path $repoRoot 'node_modules'))) {
    Invoke-Npm -Arguments @('install')
  }

  if (Test-BuildRequired) {
    Invoke-Npm -Arguments @('run', 'build')
  }

  if (Test-AppReady -Port $port) {
    Write-Host "Actual Plan is already running at $url. Opening it now..." -ForegroundColor Green
    Start-Process $url | Out-Null
    exit 0
  }

  Write-Host "Starting Actual Plan at $url" -ForegroundColor Green
  Write-Host "Data directory: $($envInfo.DataDir)" -ForegroundColor Green
  Write-Host 'Keep this window open while you use the app.' -ForegroundColor Yellow

  $browserJob = Start-Job -ArgumentList $port -ScriptBlock {
    param($ReadyPort)
    $readyUrl = "http://localhost:$ReadyPort"
    for ($i = 0; $i -lt 60; $i++) {
      Start-Sleep -Seconds 1
      try {
        $response = Invoke-WebRequest -Uri "$readyUrl/api/calendar/status" -UseBasicParsing -TimeoutSec 2
        if ($response.StatusCode -eq 200) {
          Start-Process $readyUrl | Out-Null
          return
        }
      }
      catch {
      }
    }
  }

  Push-Location $repoRoot
  try {
    & node server/prod.js
  }
  finally {
    Pop-Location
    Stop-Job $browserJob -ErrorAction SilentlyContinue | Out-Null
    Remove-Job $browserJob -Force -ErrorAction SilentlyContinue | Out-Null
  }
}
catch {
  Write-Host ''
  Write-Error $_
  exit 1
}
