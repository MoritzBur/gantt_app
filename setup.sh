#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
ENV_EXAMPLE_FILE="$SCRIPT_DIR/.env.example"

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

set_env_value() {
  local key="$1"
  local value="$2"
  local tmp_file

  if [ ! -f "$ENV_FILE" ]; then
    printf '%s=%s\n' "$key" "$value" >"$ENV_FILE"
    return 0
  fi

  tmp_file="$(mktemp)"
  awk -v key="$key" -v value="$value" '
    BEGIN { updated = 0 }
    $0 ~ "^[[:space:]]*" key "=" {
      print key "=" value
      updated = 1
      next
    }
    { print }
    END {
      if (!updated) {
        print key "=" value
      }
    }
  ' "$ENV_FILE" >"$tmp_file"
  mv "$tmp_file" "$ENV_FILE"
}

looks_like_nested_zip_extract() {
  local leaf_name
  local parent_name
  leaf_name="$(basename "$SCRIPT_DIR")"
  parent_name="$(basename "$(dirname "$SCRIPT_DIR")")"
  [[ "$leaf_name" = "gantt_app" && "$parent_name" =~ ^Gantt\ App(\ \([0-9]+\))?$ ]]
}

generate_session_secret() {
  node -e "process.stdout.write(require('crypto').randomBytes(48).toString('hex'))"
}

say "Checking prerequisites..."

require_command node "Node.js 20 or newer is required. Install it from https://nodejs.org/ and rerun this script."
require_command npm "npm is required. Install Node.js from https://nodejs.org/ and rerun this script."

node_major="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || printf '')"
if [ -z "$node_major" ] || [ "$node_major" -lt 20 ]; then
  fail "Detected Node.js $(node -v). This project expects Node.js 20 or newer."
fi

say "Node: $(node -v)"
say "npm:  $(npm -v)"

say ""
if looks_like_nested_zip_extract; then
  say "Warning: this looks like the nested ZIP layout 'Gantt App/gantt_app/...'."
  say "The app can still run here, but the cleaner fix is to move the inner gantt_app folder contents up one level."
  say ""
fi

say ""
say "Installing dependencies with npm..."
(cd "$SCRIPT_DIR" && npm install)

say ""
if [ ! -f "$ENV_FILE" ]; then
  cp "$ENV_EXAMPLE_FILE" "$ENV_FILE"
  say "Created .env from .env.example."
else
  say "Found existing .env."
fi

session_secret="$(read_env_value SESSION_SECRET)"
if [ -z "$session_secret" ]; then
  generated_secret="$(generate_session_secret)"
  set_env_value SESSION_SECRET "$generated_secret"
  say "Generated SESSION_SECRET in .env."
elif [ "$session_secret" = "change-this-to-any-long-random-string" ]; then
  generated_secret="$(generate_session_secret)"
  set_env_value SESSION_SECRET "$generated_secret"
  say "Replaced the example SESSION_SECRET in .env with a random value."
fi

gantt_data_dir="$(read_env_value GANTT_DATA_DIR)"
if [ -n "$gantt_data_dir" ]; then
  say "GANTT_DATA_DIR is set to: $gantt_data_dir"
else
  say "GANTT_DATA_DIR is not set. The app will store local data in ./data by default."
fi

say ""
if command -v git >/dev/null 2>&1; then
  say "Git:  $(git --version)"
  say "Basic planning works without Git expertise."
  say "If your data directory is a Git repo, the History panel can save Git-backed snapshots."
else
  say "Git was not found on PATH."
  say "Basic planning still works, but Git-backed snapshot/history workflows need Git installed."
fi

say ""
say "Setup complete."
case "$(uname -s)" in
  Darwin|Linux)
    say "For everyday use, create a launcher with ./create-launcher.sh"
    say "If you prefer a manual terminal launch, start the app with ./launch.sh"
    ;;
  *)
    say "Start the app with ./start.sh --prod"
    ;;
esac
