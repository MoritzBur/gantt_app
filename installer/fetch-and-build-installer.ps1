param(
  [string]$RepoUrl = "https://github.com/MoritzBur/gantt_app.git",
  [string]$Branch = "master",
  [string]$TargetDir = "$env:USERPROFILE\Apps\gantt-app-installer-build",
  [string]$IsccPath
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Write-Step([string]$Message) {
  Write-Host $Message
}

function Fail([string]$Message) {
  throw $Message
}

function Invoke-CheckedCommand([string]$FilePath, [string[]]$Arguments, [string]$FailureMessage, [string]$WorkingDirectory = $null) {
  if ([string]::IsNullOrWhiteSpace($WorkingDirectory)) {
    & $FilePath @Arguments
  } else {
    Push-Location $WorkingDirectory
    try {
      & $FilePath @Arguments
    } finally {
      Pop-Location
    }
  }

  if ($LASTEXITCODE -ne 0) {
    Fail "$FailureMessage (exit code $LASTEXITCODE)"
  }
}

function Require-Command([string]$CommandName, [string]$Guidance) {
  if (-not (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
    Fail $Guidance
  }
}

Require-Command "git" "Git is required for fetch-and-build-installer.ps1. Install Git for Windows and rerun this script."
Require-Command "powershell" "Windows PowerShell is required for the installer build helper."

$TargetDir = [System.IO.Path]::GetFullPath($TargetDir)
$BuildScript = Join-Path $TargetDir "installer/build-installer.ps1"
$GitDir = Join-Path $TargetDir ".git"

Write-Step "Preparing Windows installer build checkout..."
Write-Step "Repo:   $RepoUrl"
Write-Step "Branch: $Branch"
Write-Step "Target: $TargetDir"
Write-Step ""

if (-not (Test-Path $TargetDir)) {
  New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
}

if (Test-Path $GitDir) {
  Write-Step "Existing checkout found. Updating it..."
  $statusOutput = (& git -C $TargetDir status --porcelain=v1).Trim()
  if (-not [string]::IsNullOrWhiteSpace($statusOutput)) {
    Fail "The existing build checkout has local changes in $TargetDir. Commit, stash, or delete that folder before reusing this helper."
  }

  Invoke-CheckedCommand -FilePath "git" -Arguments @("-C", $TargetDir, "fetch", "origin", $Branch) -FailureMessage "git fetch failed"
  Invoke-CheckedCommand -FilePath "git" -Arguments @("-C", $TargetDir, "checkout", $Branch) -FailureMessage "git checkout failed"
  Invoke-CheckedCommand -FilePath "git" -Arguments @("-C", $TargetDir, "pull", "--ff-only", "origin", $Branch) -FailureMessage "git pull failed"
} else {
  Write-Step "No checkout found yet. Cloning fresh..."
  if ((Get-ChildItem -Force $TargetDir | Measure-Object).Count -gt 0) {
    Fail "Target directory $TargetDir exists but is not a git checkout. Remove it or choose a different -TargetDir."
  }

  Invoke-CheckedCommand -FilePath "git" -Arguments @("clone", "--branch", $Branch, $RepoUrl, $TargetDir) -FailureMessage "git clone failed"
}

if (-not (Test-Path $BuildScript)) {
  Fail "Could not find installer/build-installer.ps1 in $TargetDir"
}

Write-Step ""
Write-Step "Running installer build..."

$buildArguments = @(
  "-ExecutionPolicy", "Bypass",
  "-File", $BuildScript
)
if (-not [string]::IsNullOrWhiteSpace($IsccPath)) {
  $buildArguments += @("-IsccPath", $IsccPath)
}

Invoke-CheckedCommand -FilePath "powershell" -Arguments $buildArguments -FailureMessage "Installer build failed" -WorkingDirectory $TargetDir

$PackageJson = Get-Content (Join-Path $TargetDir "package.json") -Raw | ConvertFrom-Json
$Version = $PackageJson.version
$InstallerPath = Join-Path $TargetDir "installer/dist/GanttApp-Setup-$Version.exe"

Write-Step ""
Write-Step "Done."
Write-Step "Installer path: $InstallerPath"
