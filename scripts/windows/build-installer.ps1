. (Join-Path $PSScriptRoot 'common.ps1')

function Get-InnoCompiler {
  $command = Get-Command ISCC.exe -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $candidates = @(
    'C:\Program Files (x86)\Inno Setup 6\ISCC.exe',
    'C:\Program Files\Inno Setup 6\ISCC.exe',
    'C:\Program Files\Inno Setup 7\ISCC.exe'
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  throw "ISCC.exe was not found. Install Inno Setup 6.7+ from https://jrsoftware.org/isdl.php and run this again."
}

try {
  $repoRoot = Get-RepoRoot
  $issPath = Join-Path $repoRoot 'installer\windows\actual-plan.iss'
  $packageJson = Get-Content (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json
  $appVersion = $packageJson.version
  $iscc = Get-InnoCompiler

  if (-not (Test-Path (Join-Path $repoRoot 'dist\windows\Actual Plan.exe'))) {
    Invoke-Npm -Arguments @('run', 'build:windows:exe')
  }

  & $iscc "/DAppVersion=$appVersion" $issPath
  if ($LASTEXITCODE -ne 0) {
    throw "Inno Setup compilation failed with exit code $LASTEXITCODE."
  }
}
catch {
  Write-Host ''
  Write-Error $_
  exit 1
}
