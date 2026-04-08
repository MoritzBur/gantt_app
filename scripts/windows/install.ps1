. (Join-Path $PSScriptRoot 'common.ps1')

try {
  Write-Host 'Preparing Actual Plan for Windows...' -ForegroundColor Green
  Assert-NodeVersion

  $envInfo = Ensure-EnvFile
  if ($envInfo.Created) {
    Write-Host "Created $($envInfo.EnvPath)." -ForegroundColor Green
  } else {
    Write-Host "Using existing $($envInfo.EnvPath)." -ForegroundColor Green
  }
  Write-Host "Planning data will live in $($envInfo.DataDir)." -ForegroundColor Green

  Invoke-Npm -Arguments @('install')
  Invoke-Npm -Arguments @('run', 'build')

  Write-Host ''
  Write-Host 'Install complete.' -ForegroundColor Green
  Write-Host 'Launch the app with launch-windows.cmd.' -ForegroundColor Green
}
catch {
  Write-Host ''
  Write-Error $_
  exit 1
}
