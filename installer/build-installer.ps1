param(
  [string]$IsccPath
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Copy-InstallerPath([string]$SourceRoot, [string]$DestinationRoot, [string]$RelativePath) {
  $sourcePath = Join-Path $SourceRoot $RelativePath
  if (-not (Test-Path $sourcePath)) {
    throw "Required path not found: $RelativePath"
  }

  $destinationPath = Join-Path $DestinationRoot $RelativePath
  $destinationParent = Split-Path -Parent $destinationPath
  if (-not (Test-Path $destinationParent)) {
    New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null
  }

  Copy-Item -Path $sourcePath -Destination $destinationPath -Recurse -Force
}

function Resolve-IsccPath([string]$ExplicitPath) {
  if (-not [string]::IsNullOrWhiteSpace($ExplicitPath)) {
    if (-not (Test-Path $ExplicitPath)) {
      throw "ISCC was not found at $ExplicitPath"
    }

    return (Resolve-Path $ExplicitPath).Path
  }

  $command = Get-Command iscc.exe -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $commonPaths = @()
  foreach ($root in @(${env:ProgramFiles(x86)}, $env:ProgramFiles)) {
    if (-not [string]::IsNullOrWhiteSpace($root)) {
      $commonPaths += Join-Path $root "Inno Setup 6\ISCC.exe"
    }
  }

  foreach ($candidate in $commonPaths) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  throw "Could not find ISCC.exe. Install Inno Setup 6 or pass -IsccPath."
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$IssPath = Join-Path $ScriptDir "actual-plan.iss"
$PackageJsonPath = Join-Path $RepoRoot "package.json"
$OutputDir = Join-Path $ScriptDir "dist"

$PackageJson = Get-Content $PackageJsonPath -Raw | ConvertFrom-Json
$Version = $PackageJson.version
if ([string]::IsNullOrWhiteSpace($Version)) {
  throw "package.json does not contain a version."
}

$StageDir = Join-Path $ScriptDir "staging"
$StageRoot = Join-Path $StageDir "actual-plan-$Version"

if (Test-Path $StageRoot) {
  Remove-Item -Path $StageRoot -Recurse -Force
}

New-Item -ItemType Directory -Path $StageRoot -Force | Out-Null
New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

$IncludedPaths = @(
  ".env.example",
  "README.md",
  "package.json",
  "package-lock.json",
  "setup.ps1",
  "start.ps1",
  "launch-windows.ps1",
  "launch-windows.vbs",
  "launch-windows.cmd",
  "create-windows-shortcut.ps1",
  "icons",
  "client/index.html",
  "client/vite.config.js",
  "client/public",
  "client/src",
  "server"
)

foreach ($relativePath in $IncludedPaths) {
  Copy-InstallerPath -SourceRoot $RepoRoot -DestinationRoot $StageRoot -RelativePath $RelativePath
}

$CompilerPath = Resolve-IsccPath -ExplicitPath $IsccPath

Write-Host "Building Actual Plan installer version $Version"
Write-Host "Source staging: $StageRoot"
Write-Host "Output dir:     $OutputDir"
Write-Host "ISCC:           $CompilerPath"

& $CompilerPath `
  "/DAppVersion=$Version" `
  "/DSourceDir=$StageRoot" `
  "/DOutputDir=$OutputDir" `
  $IssPath

if ($LASTEXITCODE -ne 0) {
  throw "ISCC.exe failed with exit code $LASTEXITCODE."
}

Write-Host ""
Write-Host "Installer build complete."
Write-Host "Expected output: $(Join-Path $OutputDir "ActualPlan-Setup-$Version.exe")"
