#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM="$(uname -s)"
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

apple_literal() {
  local value="$1"
  value=${value//\\/\\\\}
  value=${value//\"/\\\"}
  value=${value//$'\n'/\" & linefeed & \"}
  printf '"%s"' "$value"
}

build_launch_args() {
  local args=()
  if [ "$OPEN_BROWSER" = "1" ]; then
    args+=("--open-browser")
  fi
  if [ "$QUIET" = "1" ]; then
    args+=("--quiet")
  fi
  printf '%s\n' "${args[*]:-}"
}

write_wrapper() {
  local wrapper_path="$1"
  local launch_args="$2"

  cat >"$wrapper_path" <<EOF
#!/usr/bin/env bash
set -euo pipefail
exec $(printf '%q' "$SCRIPT_DIR/launch.sh") ${launch_args:+$launch_args }"\$@"
EOF
  chmod +x "$wrapper_path"
}

set_macos_icon() {
  local app_path="$1"
  local source_png="$SCRIPT_DIR/client/public/web-app-manifest-512x512.png"
  local iconset_dir
  local icns_path
  local size

  if [ ! -f "$source_png" ]; then
    return 0
  fi

  if ! command -v sips >/dev/null 2>&1 || ! command -v iconutil >/dev/null 2>&1; then
    return 0
  fi

  iconset_dir="$(mktemp -d "${TMPDIR:-/tmp}/gantt-app.iconset.XXXXXX")"
  icns_path="$iconset_dir/applet.icns"

  for size in 16 32 128 256 512; do
    sips -z "$size" "$size" "$source_png" --out "$iconset_dir/icon_${size}x${size}.png" >/dev/null
    if [ "$size" -lt 512 ]; then
      sips -z "$((size * 2))" "$((size * 2))" "$source_png" --out "$iconset_dir/icon_${size}x${size}@2x.png" >/dev/null
    fi
  done

  iconutil -c icns "$iconset_dir" -o "$icns_path" >/dev/null
  cp "$icns_path" "$app_path/Contents/Resources/applet.icns"
  touch "$app_path"
  rm -rf "$iconset_dir"
}

create_macos_launcher() {
  local support_dir="$HOME/Library/Application Support/Gantt App"
  local wrapper_path="$support_dir/launch-gantt-app.sh"
  local app_dir="$HOME/Applications/Gantt App.app"
  local applescript_path
  local launch_args

  mkdir -p "$support_dir" "$HOME/Applications"
  launch_args="$(build_launch_args)"
  write_wrapper "$wrapper_path" "$launch_args"

  if command -v osacompile >/dev/null 2>&1; then
    applescript_path="$(mktemp "${TMPDIR:-/tmp}/gantt-app-launcher.XXXXXX.applescript")"
    cat >"$applescript_path" <<EOF
on run
  set launcherPath to $(apple_literal "$wrapper_path")
  do shell script quoted form of launcherPath
end run
EOF

    rm -rf "$app_dir"
    osacompile -o "$app_dir" "$applescript_path" >/dev/null
    rm -f "$applescript_path"
    set_macos_icon "$app_dir"

    say "Created launcher app at $app_dir"
    say "You can open it from Finder and drag it to the Dock for everyday use."
    return 0
  fi

  local command_path="$HOME/Desktop/Gantt App.command"
  cat >"$command_path" <<EOF
#!/usr/bin/env bash
set -euo pipefail
exec $(printf '%q' "$wrapper_path") "\$@"
EOF
  chmod +x "$command_path"

  say "Created Finder launcher at $command_path"
  say "Double-click it to start Gantt App."
}

create_linux_launcher() {
  local bin_dir="$HOME/.local/bin"
  local applications_dir="$HOME/.local/share/applications"
  local wrapper_path="$bin_dir/gantt-app-launch"
  local desktop_file="$applications_dir/gantt-app.desktop"
  local desktop_copy="$HOME/Desktop/Gantt App.desktop"
  local icon_path="$SCRIPT_DIR/client/public/web-app-manifest-512x512.png"
  local launch_args

  mkdir -p "$bin_dir" "$applications_dir"
  launch_args="$(build_launch_args)"
  write_wrapper "$wrapper_path" "$launch_args"

  cat >"$desktop_file" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Gantt App
Comment=Local-first Gantt planner
Exec=$(printf '%q' "$wrapper_path")
Path=$(printf '%q' "$SCRIPT_DIR")
Icon=$(printf '%q' "$icon_path")
Terminal=false
Categories=Office;ProjectManagement;
StartupNotify=true
EOF

  say "Created application launcher at $desktop_file"

  if [ -d "$HOME/Desktop" ]; then
    cp "$desktop_file" "$desktop_copy"
    chmod +x "$desktop_copy"
    if command -v gio >/dev/null 2>&1; then
      gio set "$desktop_copy" metadata::trusted true >/dev/null 2>&1 || true
    fi

    say "Created desktop launcher at $desktop_copy"
    say "If your desktop blocks it the first time, right-click it and choose Allow Launching."
  fi

  say "You can pin the app launcher from your desktop environment's app menu or dock."
}

case "$PLATFORM" in
  Darwin)
    create_macos_launcher
    ;;
  Linux)
    create_linux_launcher
    ;;
  *)
    printf 'ERROR: create-launcher.sh supports macOS and Linux. Use create-windows-shortcut.ps1 on Windows.\n' >&2
    exit 1
    ;;
esac
