#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "launch.sh is a legacy wrapper."
echo "The primary documented launcher is ./start.sh."

exec "$SCRIPT_DIR/start.sh" "$@"
