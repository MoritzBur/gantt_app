#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

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

MODE="dev"
if [ "${1:-}" = "--prod" ]; then
  MODE="prod"
fi

require_command node "Node.js 20 or newer is required. Install it from https://nodejs.org/ and rerun this script."
require_command npm "npm is required. Install Node.js from https://nodejs.org/ and rerun this script."

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

if [ "$session_secret" = "change-this-to-any-long-random-string" ]; then
  say "Warning: SESSION_SECRET is still using the example value in .env."
fi

port="$(read_env_value PORT)"
if [ -z "$port" ]; then
  port="3000"
fi

gantt_data_dir="$(read_env_value GANTT_DATA_DIR)"

say "Starting Gantt App from $SCRIPT_DIR"
if [ -n "$gantt_data_dir" ]; then
  say "Data directory: $gantt_data_dir"
else
  say "Data directory: $SCRIPT_DIR/data"
fi

if [ "$MODE" = "prod" ]; then
  say "Mode: production"
  say "The app will be available at http://localhost:$port"
  (cd "$SCRIPT_DIR" && npm run build)
  cd "$SCRIPT_DIR"
  exec npm start
fi

say "Mode: development"
say "Backend:  http://localhost:$port"
say "Frontend: http://localhost:5173"
say "Open the frontend URL once Vite reports that it is ready."

cd "$SCRIPT_DIR"
exec npm run dev
