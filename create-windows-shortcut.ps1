param(
  [string]$ShortcutPath = $(Join-Path ([Environment]::GetFolderPath("Desktop")) "Actual Plan.lnk"),
  [string]$IconPath,
  [switch]$OpenBrowser,
  [switch]$Quiet
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$HiddenLauncherPath = Join-Path $RepoRoot "launch-windows.vbs"
$WScriptPath = Join-Path $env:SystemRoot "System32\wscript.exe"
$DefaultIconPath = Join-Path $RepoRoot "icons\icon-launcher.svg"
$FallbackIconPath = Join-Path $RepoRoot "icons\actual-plan.ico"
$LegacyIconPath = Join-Path $RepoRoot "actual-plan.ico"

if (-not (Test-Path $HiddenLauncherPath)) {
  throw "Could not find launch-windows.vbs in $RepoRoot"
}

if (-not (Test-Path $WScriptPath)) {
  throw "Could not find wscript.exe at $WScriptPath"
}

$arguments = @()
$arguments += "`"$HiddenLauncherPath`""
if ($OpenBrowser) {
  $arguments += "-OpenBrowser"
}
if ($Quiet) {
  $arguments += "-Quiet"
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($ShortcutPath)
$shortcut.TargetPath = $WScriptPath
$shortcut.WorkingDirectory = $RepoRoot
$shortcut.Arguments = ($arguments -join " ")
$shortcut.Description = "Launch Actual Plan without opening a console window"

if (-not [string]::IsNullOrWhiteSpace($IconPath)) {
  if (-not (Test-Path $IconPath)) {
    throw "Icon file not found: $IconPath"
  }
  $shortcut.IconLocation = "$IconPath,0"
} elseif (Test-Path $DefaultIconPath) {
  $shortcut.IconLocation = "$DefaultIconPath,0"
} elseif (Test-Path $FallbackIconPath) {
  $shortcut.IconLocation = "$FallbackIconPath,0"
} elseif (Test-Path $LegacyIconPath) {
  $shortcut.IconLocation = "$LegacyIconPath,0"
}

$shortcut.Save()

Write-Host "Created shortcut at $ShortcutPath"
if ($arguments.Count -gt 0) {
  Write-Host "Shortcut arguments: $($arguments -join ' ')"
}
Write-Host "You can pin that shortcut to Start or the taskbar from Windows Explorer."
