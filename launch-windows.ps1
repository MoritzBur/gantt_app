param(
  [switch]$OpenBrowser,
  [switch]$Quiet
)

$ErrorActionPreference = "Stop"

function Fail([string]$Message) {
  throw $Message
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

function Show-Popup([string]$Message, [string]$Title = "Gantt App", [int]$Flags = 64) {
  if ($Quiet) {
    return
  }

  try {
    $shell = New-Object -ComObject WScript.Shell
    $null = $shell.Popup($Message, 0, $Title, $Flags)
  } catch {
    Write-Host $Message
  }
}

function Test-PortListening([int]$Port) {
  $client = New-Object System.Net.Sockets.TcpClient
  $waitHandle = $null

  try {
    $async = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
    $waitHandle = $async.AsyncWaitHandle
    if (-not $waitHandle.WaitOne(500)) {
      return $false
    }

    $client.EndConnect($async) | Out-Null
    return $true
  } catch {
    return $false
  } finally {
    if ($waitHandle) {
      $waitHandle.Close()
    }
    $client.Close()
  }
}

function Test-GanttApi([string]$BaseUrl) {
  try {
    $response = Invoke-WebRequest -Uri "$BaseUrl/api/tasks" -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Wait-ForGanttApi([string]$BaseUrl, $Process, [int]$TimeoutSeconds = 90) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

  while ((Get-Date) -lt $deadline) {
    if (Test-GanttApi -BaseUrl $BaseUrl) {
      return $true
    }

    if ($Process.HasExited) {
      return $false
    }

    Start-Sleep -Milliseconds 500
  }

  return (Test-GanttApi -BaseUrl $BaseUrl)
}

try {
  $RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
  $EnvFile = Join-Path $RepoRoot ".env"
  $NodeModules = Join-Path $RepoRoot "node_modules"
  $StartScript = Join-Path $RepoRoot "start.ps1"

  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Fail "Node.js 20 or newer is required. Install it from https://nodejs.org/ and rerun the launcher."
  }

  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Fail "npm is required. Install Node.js from https://nodejs.org/ and rerun the launcher."
  }

  if (-not (Test-Path $NodeModules)) {
    Fail "Dependencies are not installed yet. Run setup.ps1 first."
  }

  if (-not (Test-Path $StartScript)) {
    Fail "Could not find start.ps1 in $RepoRoot"
  }

  if (-not (Test-Path $EnvFile)) {
    Fail "No .env file found. Run setup.ps1 first."
  }

  $SessionSecret = Get-EnvValue $EnvFile "SESSION_SECRET"
  if ([string]::IsNullOrWhiteSpace($SessionSecret)) {
    Fail "SESSION_SECRET is missing in .env."
  }

  $PortText = Get-EnvValue $EnvFile "PORT"
  if ([string]::IsNullOrWhiteSpace($PortText)) {
    $PortText = "3000"
  }

  $Port = 0
  if (-not [int]::TryParse($PortText, [ref]$Port)) {
    Fail "PORT in .env must be a number."
  }

  $BaseUrl = "http://localhost:$Port"

  if (Test-GanttApi -BaseUrl $BaseUrl) {
    if ($OpenBrowser) {
      Start-Process $BaseUrl
    }

    Show-Popup -Message "Gantt App is already running.`n`nAvailable at:`n$BaseUrl"
    exit 0
  }

  if (Test-PortListening -Port $Port) {
    Show-Popup -Title "Gantt App" -Flags 16 -Message "Port $Port is already in use, so Gantt App could not be started.`n`nChange PORT in .env or stop the other app."
    exit 1
  }

  $launcherProcess = Start-Process `
    -FilePath "powershell.exe" `
    -ArgumentList @("-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $StartScript, "-Production") `
    -WorkingDirectory $RepoRoot `
    -WindowStyle Minimized `
    -PassThru

  if (Wait-ForGanttApi -BaseUrl $BaseUrl -Process $launcherProcess) {
    if ($OpenBrowser) {
      Start-Process $BaseUrl
    }

    Show-Popup -Message "Gantt App has been started.`n`nAvailable at:`n$BaseUrl"
    exit 0
  }

  if ($launcherProcess.HasExited) {
    Show-Popup -Title "Gantt App" -Flags 16 -Message "Gantt App could not be started.`n`nRun .\start.ps1 -Production in PowerShell to see the error details."
    exit 1
  }

  if ($OpenBrowser) {
    Start-Process $BaseUrl
  }

  Show-Popup -Message "Gantt App is still starting.`n`nTry:`n$BaseUrl"
} catch {
  Show-Popup -Title "Gantt App" -Flags 16 -Message $_.Exception.Message
  exit 1
}
