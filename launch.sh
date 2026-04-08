#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/gantt-app"
LOG_FILE="$STATE_DIR/launch.log"

OPEN_BROWSER=0
QUIET=0

for arg in "$@"; do
  case "$arg" in
    --open-browser)
      OPEN_BROWSER=1
      ;;
    --quiet)
      QUIET=1
      ;;
    *)
      printf 'ERROR: Unknown argument: %s\n' "$arg" >&2
      exit 1
      ;;
  esac
done

say() {
  printf '%s\n' "$1"
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

require_command() {
  local command_name="$1"
  local guidance="$2"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    fail "$guidance"
  fi
}

read_env_value() {
  local key="$1"
  if [ ! -f "$ENV_FILE" ]; then
    return 0
  fi

  local line
  line="$(grep -E "^[[:space:]]*$key=" "$ENV_FILE" | tail -n 1 || true)"
  line="${line#*=}"
  line="${line%$'\r'}"
  printf '%s' "$line"
}

apple_literal() {
  local value="$1"
  value=${value//\\/\\\\}
  value=${value//\"/\\\"}
  value=${value//$'\n'/\" & linefeed & \"}
  printf '"%s"' "$value"
}

show_notification() {
  local title="$1"
  local message="$2"
  local level="${3:-info}"
  local platform

  if [ "$QUIET" = "1" ]; then
    return 0
  fi

  platform="$(uname -s)"
  case "$platform" in
    Darwin)
      if command -v osascript >/dev/null 2>&1; then
        /usr/bin/osascript -e "display notification $(apple_literal "$message") with title $(apple_literal "$title")" >/dev/null 2>&1 || true
        return 0
      fi
      ;;
    Linux)
      if command -v notify-send >/dev/null 2>&1; then
        local urgency="normal"
        case "$level" in
          error) urgency="critical" ;;
          warning) urgency="normal" ;;
        esac

        notify-send \
          --app-name="Gantt App" \
          --urgency="$urgency" \
          --icon="$SCRIPT_DIR/client/public/icon-launcher.svg" \
          "$title" \
          "$message" >/dev/null 2>&1 || true
        return 0
      fi
      ;;
  esac

  say "$title"
  say "$message"
}

open_browser_now() {
  local base_url="$1"
  case "$(uname -s)" in
    Darwin)
      open "$base_url" >/dev/null 2>&1 || true
      ;;
    Linux)
      if command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$base_url" >/dev/null 2>&1 || true
      fi
      ;;
  esac
}

test_gantt_api() {
  local port="$1"
  node - "$port" <<'NODE'
const http = require('http');
const port = Number(process.argv[2]);
const req = http.get(
  {
    hostname: '127.0.0.1',
    port,
    path: '/api/tasks',
    timeout: 1500,
  },
  (res) => {
    res.resume();
    process.exit(res.statusCode === 200 ? 0 : 1);
  }
);
req.on('timeout', () => {
  req.destroy();
  process.exit(1);
});
req.on('error', () => process.exit(1));
NODE
}

test_port_listening() {
  local port="$1"
  node - "$port" <<'NODE'
const net = require('net');
const port = Number(process.argv[2]);
const socket = net.connect({ host: '127.0.0.1', port });
socket.setTimeout(500);
socket.on('connect', () => {
  socket.destroy();
  process.exit(0);
});
socket.on('timeout', () => {
  socket.destroy();
  process.exit(1);
});
socket.on('error', () => process.exit(1));
NODE
}

wait_for_gantt_api() {
  local port="$1"
  local process_id="$2"
  local timeout_seconds="${3:-90}"
  local started_at

  started_at="$(date +%s)"
  while true; do
    if test_gantt_api "$port"; then
      return 0
    fi

    if ! kill -0 "$process_id" >/dev/null 2>&1; then
      return 1
    fi

    if [ $(( "$(date +%s)" - started_at )) -ge "$timeout_seconds" ]; then
      break
    fi

    sleep 0.5
  done

  test_gantt_api "$port"
}

require_command node "Node.js 20 or newer is required. Install it from https://nodejs.org/ and rerun this launcher."
require_command npm "npm is required. Install Node.js from https://nodejs.org/ and rerun this launcher."

node_major="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || printf '')"
if [ -z "$node_major" ] || [ "$node_major" -lt 20 ]; then
  fail "Detected Node.js $(node -v). This project expects Node.js 20 or newer."
fi

if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
  fail "Dependencies are not installed yet. Run ./setup.sh first."
fi

if [ ! -f "$ENV_FILE" ]; then
  fail "No .env file found. Run ./setup.sh first."
fi

session_secret="$(read_env_value SESSION_SECRET)"
if [ -z "$session_secret" ]; then
  fail "SESSION_SECRET is missing in .env."
fi

port="$(read_env_value PORT)"
if [ -z "$port" ]; then
  port="3000"
fi

case "$port" in
  ''|*[!0-9]*)
    fail "PORT in .env must be a number."
    ;;
esac

base_url="http://localhost:$port"

if test_gantt_api "$port"; then
  if [ "$OPEN_BROWSER" = "1" ]; then
    open_browser_now "$base_url"
  fi

  show_notification "Gantt App" "$(printf 'Gantt App is already running.\n\nAvailable at:\n%s' "$base_url")"
  exit 0
fi

if test_port_listening "$port"; then
  show_notification "Gantt App" "$(printf 'Port %s is already in use, so Gantt App could not be started.\n\nChange PORT in .env or stop the other app.' "$port")" "error"
  exit 1
fi

mkdir -p "$STATE_DIR"
cd "$SCRIPT_DIR"
nohup "$SCRIPT_DIR/start.sh" --prod >>"$LOG_FILE" 2>&1 &
launcher_pid="$!"

if wait_for_gantt_api "$port" "$launcher_pid"; then
  if [ "$OPEN_BROWSER" = "1" ]; then
    open_browser_now "$base_url"
  fi

  show_notification "Gantt App" "$(printf 'Gantt App has been started.\n\nAvailable at:\n%s' "$base_url")"
  exit 0
fi

if ! kill -0 "$launcher_pid" >/dev/null 2>&1; then
  show_notification "Gantt App" "$(printf 'Gantt App could not be started.\n\nRun ./start.sh --prod in Terminal to see the error details.\nLog: %s' "$LOG_FILE")" "error"
  exit 1
fi

if [ "$OPEN_BROWSER" = "1" ]; then
  open_browser_now "$base_url"
fi

show_notification "Gantt App" "$(printf 'Gantt App is still starting.\n\nTry:\n%s' "$base_url")" "warning"
