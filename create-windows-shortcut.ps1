param(
  [string]$ShortcutPath = $(Join-Path ([Environment]::GetFolderPath("Desktop")) "Gantt App.lnk"),
  [string]$IconPath,
  [switch]$OpenBrowser,
  [switch]$Quiet
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$LauncherPath = Join-Path $RepoRoot "launch-windows.cmd"
$DefaultIconPath = Join-Path $RepoRoot "icons/gantt-app.ico"
$LegacyIconPath = Join-Path $RepoRoot "gantt-app.ico"

if (-not (Test-Path $LauncherPath)) {
  throw "Could not find launch-windows.cmd in $RepoRoot"
}

$arguments = @()
if ($OpenBrowser) {
  $arguments += "-OpenBrowser"
}
if ($Quiet) {
  $arguments += "-Quiet"
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($ShortcutPath)
$shortcut.TargetPath = $LauncherPath
$shortcut.WorkingDirectory = $RepoRoot
$shortcut.Arguments = ($arguments -join " ")
$shortcut.Description = "Launch Gantt App"

if (-not [string]::IsNullOrWhiteSpace($IconPath)) {
  if (-not (Test-Path $IconPath)) {
    throw "Icon file not found: $IconPath"
  }
  $shortcut.IconLocation = "$IconPath,0"
} elseif (Test-Path $DefaultIconPath) {
  $shortcut.IconLocation = "$DefaultIconPath,0"
} elseif (Test-Path $LegacyIconPath) {
  $shortcut.IconLocation = "$LegacyIconPath,0"
}

$shortcut.Save()

Write-Host "Created shortcut at $ShortcutPath"
if ($arguments.Count -gt 0) {
  Write-Host "Shortcut arguments: $($arguments -join ' ')"
}
