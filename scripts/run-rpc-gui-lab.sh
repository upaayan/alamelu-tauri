#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RESET=0
BUILD=0
for arg in "$@"; do
  case "$arg" in
    --reset) RESET=1 ;;
    --build) BUILD=1 ;;
    -h|--help)
      cat <<'USAGE'
Usage: scripts/run-rpc-gui-lab.sh [--reset] [--build]

Launch the isolated pi-gui RPC lab app.

Options:
  --reset   Delete lab state before launching.
  --build   Rebuild the desktop app before launching.
USAGE
      exit 0
      ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

LAB_BASE="${PI_GUI_RPC_LAB_BASE:-$HOME/tmp}"
AGENT_DIR="${PI_CODING_AGENT_DIR:-$LAB_BASE/pi-gui-rpc-agent}"
SESSION_DIR="${PI_CODING_AGENT_SESSION_DIR:-$LAB_BASE/pi-gui-rpc-sessions}"
USER_DATA_DIR="${PI_GUI_USER_DATA_DIR:-$LAB_BASE/pi-gui-rpc-user-data}"
LAB_WORKSPACE="${PI_GUI_LAB_WORKSPACE:-$LAB_BASE/pi-gui-rpc-workspace}"
PRODUCTION_AGENT_DIR="$HOME/.pi/agent"
PRODUCTION_USER_DATA_DIR="$HOME/Library/Application Support/pi"
PI_BIN="${PI_GUI_PI_BIN:-$HOME/.pi/agent/bin/pi}"
ELECTRON_BIN="$ROOT/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"

realpath_portable() {
  python3 - "$1" <<'PY'
import os, sys
print(os.path.realpath(os.path.expanduser(sys.argv[1])))
PY
}

path_contains() {
  python3 - "$1" "$2" <<'PY'
import os, sys
parent = os.path.realpath(os.path.expanduser(sys.argv[1]))
child = os.path.realpath(os.path.expanduser(sys.argv[2]))
try:
    print("yes" if os.path.commonpath([parent, child]) == parent else "no")
except ValueError:
    print("no")
PY
}

require_not_inside() {
  local label="$1"
  local path_value="$2"
  local forbidden_label="$3"
  local forbidden_path="$4"
  if [ "$(path_contains "$forbidden_path" "$path_value")" = "yes" ]; then
    echo "Refusing to use $label inside $forbidden_label: $path_value" >&2
    exit 1
  fi
}

if [ "$RESET" = "1" ]; then
  rm -rf "$AGENT_DIR" "$SESSION_DIR" "$USER_DATA_DIR" "$LAB_WORKSPACE"
fi

mkdir -p "$AGENT_DIR" "$SESSION_DIR" "$USER_DATA_DIR" "$LAB_WORKSPACE"
chmod 700 "$AGENT_DIR"

require_not_inside "PI_CODING_AGENT_DIR" "$AGENT_DIR" "production .pi/agent" "$PRODUCTION_AGENT_DIR"
require_not_inside "PI_CODING_AGENT_SESSION_DIR" "$SESSION_DIR" "production .pi/agent" "$PRODUCTION_AGENT_DIR"
require_not_inside "PI_GUI_USER_DATA_DIR" "$USER_DATA_DIR" "production pi-gui userData" "$PRODUCTION_USER_DATA_DIR"
require_not_inside "PI_GUI_LAB_WORKSPACE" "$LAB_WORKSPACE" "production .pi/agent" "$PRODUCTION_AGENT_DIR"

if [[ "$PI_BIN" != /* ]]; then
  echo "PI_GUI_PI_BIN must be absolute: $PI_BIN" >&2
  exit 1
fi
PI_BIN="$(realpath_portable "$PI_BIN")"
if [ ! -x "$PI_BIN" ]; then
  echo "PI binary is not executable: $PI_BIN" >&2
  exit 1
fi

if [ ! -x "$ELECTRON_BIN" ]; then
  echo "Lab Electron binary is missing or not executable; attempting lab-local repair." >&2
  node "$ROOT/scripts/repair-electron-dist.mjs"
fi
if [ ! -x "$ELECTRON_BIN" ]; then
  echo "Lab Electron binary is still missing after repair: $ELECTRON_BIN" >&2
  exit 1
fi

AUTH_SOURCE="$PRODUCTION_AGENT_DIR/auth.json"
AUTH_DEST="$AGENT_DIR/auth.json"
if [ -f "$AUTH_SOURCE" ]; then
  rm -f "$AUTH_DEST"
  cp "$AUTH_SOURCE" "$AUTH_DEST"
  chmod 600 "$AUTH_DEST"
  AUTH_DEST_REAL="$(realpath_portable "$AUTH_DEST")"
  AGENT_DIR_REAL="$(realpath_portable "$AGENT_DIR")"
  if [ "$(path_contains "$AGENT_DIR_REAL" "$AUTH_DEST_REAL")" != "yes" ]; then
    echo "Auth copy did not resolve inside lab agent dir" >&2
    exit 1
  fi
  if [ "$(path_contains "$PRODUCTION_AGENT_DIR" "$AUTH_DEST_REAL")" = "yes" ]; then
    echo "Auth copy resolves into production .pi/agent" >&2
    exit 1
  fi
else
  echo "Warning: no production auth.json found to copy into lab agent dir." >&2
fi

if [ "$BUILD" = "1" ] || [ ! -f "$ROOT/apps/desktop/out/main/main.js" ]; then
  npx --yes pnpm@10.25.0 --filter @pi-gui/desktop build
fi

export PI_GUI_DRIVER=rpc
export PI_GUI_PI_BIN="$PI_BIN"
export PI_CODING_AGENT_DIR="$AGENT_DIR"
export PI_CODING_AGENT_SESSION_DIR="$SESSION_DIR"
export PI_GUI_USER_DATA_DIR="$USER_DATA_DIR"
export PI_GUI_LAB_WORKSPACE="$LAB_WORKSPACE"
export PI_GUI_RPC_PROVIDER="${PI_GUI_RPC_PROVIDER:-xai}"
export PI_GUI_RPC_MODEL="${PI_GUI_RPC_MODEL:-grok-code-fast-1}"
export PI_APP_OPEN_DEVTOOLS="${PI_APP_OPEN_DEVTOOLS:-0}"

cat <<EOF
Launching pi-gui RPC lab:
  Electron: $ELECTRON_BIN
  Pi:       $PI_BIN
  userData: $PI_GUI_USER_DATA_DIR
  agent:    $PI_CODING_AGENT_DIR
  sessions: $PI_CODING_AGENT_SESSION_DIR
  workspace:$PI_GUI_LAB_WORKSPACE
EOF

exec "$ELECTRON_BIN" "$ROOT/apps/desktop"
