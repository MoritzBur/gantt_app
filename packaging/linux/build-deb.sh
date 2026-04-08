#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PACKAGE_JSON="$REPO_ROOT/package.json"
README_PATH="$REPO_ROOT/README.md"
DIST_DIR="$SCRIPT_DIR/dist"
STAGING_DIR="$SCRIPT_DIR/staging"

APP_NAME="Actual Plan"
PACKAGE_NAME="actual-plan"
ARCH="amd64"
INSTALL_ROOT="/opt/actual-plan"

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'ERROR: Required command not found: %s\n' "$command_name" >&2
    exit 1
  fi
}

require_node_20() {
  local node_major
  node_major="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || printf '')"
  if [ -z "$node_major" ] || [ "$node_major" -lt 20 ]; then
    printf 'ERROR: Node.js 20 or newer is required to build the package. Found: %s\n' "$(node -v 2>/dev/null || printf 'unknown')" >&2
    exit 1
  fi
}

copy_stage_path() {
  local relative_path="$1"
  local source_path="$REPO_ROOT/$relative_path"
  local destination_path="$STAGE_APP_DIR/$relative_path"
  local destination_parent

  if [ ! -e "$source_path" ]; then
    printf 'ERROR: Required path not found: %s\n' "$relative_path" >&2
    exit 1
  fi

  destination_parent="$(dirname "$destination_path")"
  mkdir -p "$destination_parent"
  cp -a "$source_path" "$destination_path"
}

extract_icon_png() {
  local source_ico="$1"
  local destination_png="$2"

  node - "$source_ico" "$destination_png" <<'NODE'
const fs = require('fs');
const path = require('path');

const [sourcePath, destinationPath] = process.argv.slice(2);
const buffer = fs.readFileSync(sourcePath);

if (buffer.length < 6) {
  throw new Error('ICO file is too small.');
}

const imageCount = buffer.readUInt16LE(4);
let bestEntry = null;

for (let index = 0; index < imageCount; index += 1) {
  const entryOffset = 6 + (index * 16);
  const width = buffer[entryOffset] || 256;
  const height = buffer[entryOffset + 1] || 256;
  const bytesInRes = buffer.readUInt32LE(entryOffset + 8);
  const imageOffset = buffer.readUInt32LE(entryOffset + 12);

  const isBetter =
    !bestEntry ||
    (width * height) > (bestEntry.width * bestEntry.height) ||
    ((width * height) === (bestEntry.width * bestEntry.height) && bytesInRes > bestEntry.bytesInRes);

  if (isBetter) {
    bestEntry = { width, height, bytesInRes, imageOffset };
  }
}

if (!bestEntry) {
  throw new Error('No icon entries were found in the ICO file.');
}

const imageBuffer = buffer.slice(bestEntry.imageOffset, bestEntry.imageOffset + bestEntry.bytesInRes);
const pngSignature = '89504e470d0a1a0a';

if (imageBuffer.subarray(0, 8).toString('hex') !== pngSignature) {
  throw new Error('Largest ICO entry is not PNG data.');
}

fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
fs.writeFileSync(destinationPath, imageBuffer);
NODE
}

bundle_node_runtime() {
  local source_node
  source_node="$(readlink -f "$(command -v node)")"

  mkdir -p "$STAGE_APP_DIR/runtime/bin"
  cp -a "$source_node" "$STAGE_APP_DIR/runtime/bin/node"
  chmod 0755 "$STAGE_APP_DIR/runtime/bin/node"
}

install_production_dependencies() {
  (
    cd "$STAGE_APP_DIR"
    npm ci --omit=dev --ignore-scripts
  )
}

render_control() {
  cat >"$PACKAGE_ROOT/DEBIAN/control" <<EOF
Package: $PACKAGE_NAME
Version: $VERSION
Section: utils
Priority: optional
Architecture: $ARCH
Maintainer: Moritz Bur
Description: $SHORT_DESCRIPTION
 $LONG_DESCRIPTION
EOF
}

render_postinst() {
  cat >"$PACKAGE_ROOT/DEBIAN/postinst" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

DEFAULTS_DIR="/etc/actual-plan"
DEFAULTS_FILE="$DEFAULTS_DIR/install.env"
LAUNCHER="/usr/local/bin/actual-plan"

write_defaults_file() {
  local default_data_dir="${ACTUAL_PLAN_DEFAULT_DATA_DIR:-\$HOME/Actual Plan Data}"
  local default_port="${ACTUAL_PLAN_DEFAULT_PORT:-3000}"
  local escaped_data_dir="${default_data_dir//\\/\\\\}"
  escaped_data_dir="${escaped_data_dir//\"/\\\"}"

  mkdir -p "$DEFAULTS_DIR"
  cat >"$DEFAULTS_FILE" <<EOF2
# Actual Plan Linux install defaults.
# You can change these later and restart the app.
ACTUAL_PLAN_DEFAULT_DATA_DIR="$escaped_data_dir"
ACTUAL_PLAN_DEFAULT_PORT="$default_port"
EOF2
  chmod 0644 "$DEFAULTS_FILE"
}

write_defaults_file
chmod 0755 "$LAUNCHER"

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database /usr/share/applications >/dev/null 2>&1 || true
fi
EOF
}

render_prerm() {
  cat >"$PACKAGE_ROOT/DEBIAN/prerm" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

stop_actual_plan() {
  local pids
  local pid
  local deadline

  pids="$(pgrep -f '/opt/actual-plan/server/start-production\.js|/opt/actual-plan/server/prod\.js' || true)"
  if [ -z "$pids" ]; then
    return 0
  fi

  for pid in $pids; do
    kill -TERM "$pid" >/dev/null 2>&1 || true
  done

  deadline=$((SECONDS + 10))
  while [ "$SECONDS" -lt "$deadline" ]; do
    pids="$(pgrep -f '/opt/actual-plan/server/start-production\.js|/opt/actual-plan/server/prod\.js' || true)"
    if [ -z "$pids" ]; then
      return 0
    fi
    sleep 1
  done

  for pid in $pids; do
    kill -KILL "$pid" >/dev/null 2>&1 || true
  done
}

case "${1:-}" in
  remove|upgrade|deconfigure)
    stop_actual_plan
    ;;
esac

exit 0
EOF
}

render_launcher() {
  cat >"$PACKAGE_ROOT/usr/local/bin/actual-plan" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/actual-plan"
NODE_BIN="$APP_DIR/runtime/bin/node"
DEFAULTS_FILE="/etc/actual-plan/install.env"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
ENV_FILE="${GANTT_ENV_PATH:-$CONFIG_HOME/actual-plan/.env}"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/actual-plan"
LOG_FILE="$STATE_DIR/server.log"

fail() {
  printf 'Actual Plan launcher error: %s\n' "$1" >&2
  exit 1
}

read_env_value() {
  local key="$1"
  local line

  if [ ! -f "$ENV_FILE" ]; then
    return 0
  fi

  line="$(grep -E "^[[:space:]]*$key=" "$ENV_FILE" | tail -n 1 || true)"
  line="${line#*=}"
  line="${line%$'\r'}"
  printf '%s' "$line"
}

load_install_defaults() {
  if [ -f "$DEFAULTS_FILE" ]; then
    # shellcheck disable=SC1090
    . "$DEFAULTS_FILE"
    export ACTUAL_PLAN_DEFAULT_DATA_DIR ACTUAL_PLAN_DEFAULT_PORT
  fi
}

app_is_running() {
  local port="$1"
  "$NODE_BIN" - "$port" <<'NODE'
const http = require('http');
const port = Number(process.argv[2]);
const req = http.get(
  {
    hostname: '127.0.0.1',
    port,
    path: '/api/calendar/status',
    timeout: 1200,
  },
  (res) => {
    res.resume();
    process.exit(res.statusCode === 200 ? 0 : 1);
  }
);
req.on('error', () => process.exit(1));
req.on('timeout', () => {
  req.destroy();
  process.exit(1);
});
NODE
}

if [ ! -x "$NODE_BIN" ]; then
  fail "Bundled Node.js runtime is missing from $NODE_BIN."
fi

if [ ! -d "$APP_DIR/node_modules" ]; then
  fail "Dependencies are missing from $APP_DIR/node_modules."
fi

if [ ! -f "$APP_DIR/client/dist/index.html" ]; then
  fail "The packaged frontend build is missing."
fi

load_install_defaults

PORT="$(read_env_value PORT)"
if [ -z "$PORT" ]; then
  PORT="${ACTUAL_PLAN_DEFAULT_PORT:-3000}"
fi

URL="http://127.0.0.1:$PORT"
mkdir -p "$STATE_DIR"

if app_is_running "$PORT"; then
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL" >/dev/null 2>&1 || true
  fi
  exit 0
fi

(
  cd "$APP_DIR"
  nohup env \
    GANTT_APP_MODE=production \
    ACTUAL_PLAN_DEFAULT_DATA_DIR="${ACTUAL_PLAN_DEFAULT_DATA_DIR:-}" \
    ACTUAL_PLAN_DEFAULT_PORT="${ACTUAL_PLAN_DEFAULT_PORT:-}" \
    "$NODE_BIN" server/start-production.js >>"$LOG_FILE" 2>&1 &
) >/dev/null 2>&1

if command -v xdg-open >/dev/null 2>&1; then
  (
    sleep 2
    xdg-open "$URL" >/dev/null 2>&1 || true
  ) >/dev/null 2>&1 &
fi

exit 0
EOF
}

render_desktop_file() {
  cat >"$PACKAGE_ROOT/usr/share/applications/actual-plan.desktop" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=$APP_NAME
Comment=$SHORT_DESCRIPTION
Exec=/usr/local/bin/actual-plan
Icon=actual-plan
Terminal=false
Categories=Office;ProjectManagement;
StartupNotify=true
EOF
}

require_command node
require_command npm
require_command dpkg-deb
require_node_20

VERSION="$(node -p "require('$PACKAGE_JSON').version")"
if [ -z "$VERSION" ]; then
  printf 'ERROR: package.json does not contain a version.\n' >&2
  exit 1
fi

SHORT_DESCRIPTION="$(awk 'NR > 1 && NF { print; exit }' "$README_PATH")"
LONG_DESCRIPTION="Self-contained local-first planning app with a bundled Node.js runtime, prebuilt frontend assets, and a desktop launcher for Ubuntu."

PACKAGE_ROOT="$STAGING_DIR/${PACKAGE_NAME}_${VERSION}_${ARCH}"
STAGE_APP_DIR="$PACKAGE_ROOT$INSTALL_ROOT"
OUTPUT_FILE="$DIST_DIR/${PACKAGE_NAME}_${VERSION}_${ARCH}.deb"

rm -rf "$PACKAGE_ROOT"
mkdir -p \
  "$PACKAGE_ROOT/DEBIAN" \
  "$STAGE_APP_DIR" \
  "$PACKAGE_ROOT/usr/local/bin" \
  "$PACKAGE_ROOT/usr/share/applications" \
  "$PACKAGE_ROOT/usr/share/icons/hicolor/256x256/apps" \
  "$DIST_DIR"

printf 'Building frontend assets...\n'
(cd "$REPO_ROOT" && npm run build)

INCLUDED_PATHS=(
  ".env.example"
  "README.md"
  "package.json"
  "package-lock.json"
  "icons"
  "client/dist"
  "server"
)

for relative_path in "${INCLUDED_PATHS[@]}"; do
  copy_stage_path "$relative_path"
done

bundle_node_runtime

printf 'Installing production dependencies into package staging...\n'
install_production_dependencies

render_control
render_postinst
render_prerm
render_launcher
render_desktop_file
extract_icon_png "$REPO_ROOT/icons/actual-plan.ico" "$PACKAGE_ROOT/usr/share/icons/hicolor/256x256/apps/actual-plan.png"

chmod 0755 \
  "$PACKAGE_ROOT/DEBIAN/postinst" \
  "$PACKAGE_ROOT/DEBIAN/prerm" \
  "$PACKAGE_ROOT/usr/local/bin/actual-plan" \
  "$STAGE_APP_DIR/runtime/bin/node"

rm -f "$OUTPUT_FILE"
dpkg-deb --root-owner-group --build "$PACKAGE_ROOT" "$OUTPUT_FILE"

printf 'Built %s\n' "$OUTPUT_FILE"
