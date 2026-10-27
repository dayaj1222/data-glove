#!/usr/bin/env bash
# One command for the demo: start everything, connect the glove, open the browser.
#
#   ./run-demo.sh                 start (opens http://localhost:8000/#blocks)
#   ./run-demo.sh hand3d          open a different tab: device gestures actions record train predict
#                                  arcade sniper puzzle airmouse hand3d blocks
#   ./run-demo.sh --check         also run the test suite first
#   ./run-demo.sh --no-open       do not launch a browser
#   ./run-demo.sh --dev           use the React dev server on :3000 instead of the built UI
#   ./run-demo.sh stop            stop everything this script started
#
# What it does: stops stale backends / dev servers (and anything else holding the glove's serial
# port), builds the web UI if it is missing or out of date, starts ONE backend that serves the UI and
# keeps retrying the glove's USB port, waits until it is healthy and receiving sensor frames, then
# opens the browser. Ctrl+C shuts it down and releases any mouse buttons the air mouse was holding.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
LOGS="$ROOT/.run"
PY="$BACKEND/.venv/bin/python"
PORT=8000
TAB="blocks"
OPEN=1
DEV=0
CHECK=0
STOP=0

for a in "$@"; do
  case "$a" in
    --no-open) OPEN=0 ;;
    --dev) DEV=1 ;;
    --check) CHECK=1 ;;
    stop|--stop) STOP=1 ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    --*) echo "unknown option $a"; exit 2 ;;
    *) TAB="$a" ;;
  esac
done

say()  { printf '\033[1;36m[demo]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[ ok ]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[fail]\033[0m %s\n' "$*"; exit 1; }

cmdline() { tr '\0' ' ' < "/proc/$1/cmdline" 2>/dev/null; }

# PIDs listening on a TCP port
listeners() { ss -ltnpH "sport = :$1" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u; }

# Stop our own stale servers on a port; refuse to touch anything that is not ours.
free_port() {
  local port=$1 p cmd
  for p in $(listeners "$port"); do
    cmd="$(cmdline "$p")"
    case "$cmd" in
      *uvicorn*app.main*|*react-scripts*|*node*frontend*|*"http.server"*)
        say "stopping stale process $p on :$port"
        kill "$p" 2>/dev/null; sleep 1; kill -0 "$p" 2>/dev/null && kill -9 "$p" 2>/dev/null ;;
      *) die "port $port is used by something else (pid $p: ${cmd:0:80}). Free it and run again." ;;
    esac
  done
}

# Anything else holding the glove's USB serial port (an old backend, a serial monitor, ...)
free_serial() {
  local dev p cmd
  for dev in /dev/ttyUSB* /dev/ttyACM*; do
    [ -e "$dev" ] || continue
    for p in $(fuser "$dev" 2>/dev/null); do
      [ "$p" = "$$" ] && continue
      cmd="$(cmdline "$p")"
      say "$dev is held by pid $p (${cmd:0:60}); stopping it"
      kill "$p" 2>/dev/null; sleep 1; kill -0 "$p" 2>/dev/null && kill -9 "$p" 2>/dev/null
    done
  done
}

# Another run-demo.sh already supervising? Ask it to shut down (its trap stops its servers) so two
# supervisors never fight over the backend.
stop_other_instance() {
  local old
  [ -f "$LOGS/demo.pid" ] || return 0
  old="$(cat "$LOGS/demo.pid" 2>/dev/null)"
  if [ -n "$old" ] && [ "$old" != "$$" ] && kill -0 "$old" 2>/dev/null && cmdline "$old" | grep -q "run-demo"; then
    say "stopping the previous demo run (pid $old)"
    kill -TERM "$old" 2>/dev/null
    for _ in $(seq 1 20); do kill -0 "$old" 2>/dev/null || break; sleep 0.3; done
    kill -0 "$old" 2>/dev/null && kill -9 "$old" 2>/dev/null
  fi
  rm -f "$LOGS/demo.pid"
}

stop_all() {
  curl -s -m 2 -X POST "http://localhost:$PORT/api/cursor/disable" >/dev/null 2>&1   # release held mouse buttons
  if [ -f "$LOGS/backend.pid" ]; then
    local p; p="$(cat "$LOGS/backend.pid")"
    kill "$p" 2>/dev/null; sleep 1; kill -0 "$p" 2>/dev/null && kill -9 "$p" 2>/dev/null
    rm -f "$LOGS/backend.pid"
  fi
  free_port "$PORT" 2>/dev/null || true
  free_port 3000 2>/dev/null || true
}

mkdir -p "$LOGS"

if [ "$STOP" = 1 ]; then stop_other_instance; stop_all; ok "stopped"; exit 0; fi

stop_other_instance
echo $$ > "$LOGS/demo.pid"

# ---------------------------------------------------------------- preflight
[ -x "$PY" ] || die "backend venv missing: run  cd backend && uv venv .venv --python 3.12 && uv pip install --python .venv/bin/python -r requirements.txt"
command -v curl >/dev/null || die "curl is required"
command -v ss   >/dev/null || die "ss (iproute2) is required"

if [ "$CHECK" = 1 ]; then
  say "running the test suite"
  (cd "$BACKEND" && "$PY" -m pytest tests -q) || die "tests failed; not starting the demo"
  ok "tests pass"
fi

# ---------------------------------------------------------------- stale processes
say "clearing stale servers"
free_port "$PORT"
[ "$DEV" = 1 ] && free_port 3000
free_serial

# ---------------------------------------------------------------- web UI
build_needed() {
  [ -f "$FRONTEND/build/index.html" ] || return 0
  [ -n "$(find "$FRONTEND/src" "$FRONTEND/public" "$FRONTEND/package.json" -newer "$FRONTEND/build/index.html" -type f 2>/dev/null | head -1)" ]
}
if [ "$DEV" = 0 ]; then
  command -v npm >/dev/null || die "npm is required to build the UI"
  [ -d "$FRONTEND/node_modules" ] || { say "installing UI dependencies (first run only)"; (cd "$FRONTEND" && npm install --no-audit --no-fund) || die "npm install failed"; }
  if build_needed; then
    say "building the web UI (about a minute)"
    (cd "$FRONTEND" && CI=false npm run build >"$LOGS/frontend-build.log" 2>&1) || { tail -20 "$LOGS/frontend-build.log"; die "UI build failed"; }
    ok "UI built"
  else
    ok "UI build is current"
  fi
fi

# ---------------------------------------------------------------- glove
GLOVE="$(ls /dev/ttyUSB* /dev/ttyACM* 2>/dev/null | head -1 || true)"
if [ -z "$GLOVE" ]; then
  warn "no glove on USB yet (plug it in any time: the backend keeps looking)"
else
  ok "glove found on $GLOVE"
fi

# ---------------------------------------------------------------- backend
say "starting the backend"
(
  cd "$BACKEND" || exit 1
  GLOVE_AUTOOPEN=1 exec setsid "$PY" -m uvicorn app.main:app --host 0.0.0.0 --port "$PORT" \
    >"$LOGS/backend.log" 2>&1
) &
BPID=$!
echo "$BPID" > "$LOGS/backend.pid"

cleanup() {
  trap - INT TERM EXIT
  echo
  say "shutting down"
  stop_all
  rm -f "$LOGS/demo.pid"
  [ -n "${FPID:-}" ] && kill "$FPID" 2>/dev/null
  ok "bye"
  exit 0
}
trap cleanup INT TERM EXIT

for i in $(seq 1 40); do
  curl -sf -m 1 "http://localhost:$PORT/api/health" >/dev/null 2>&1 && break
  kill -0 "$BPID" 2>/dev/null || { tail -15 "$LOGS/backend.log"; die "backend exited during startup (see $LOGS/backend.log)"; }
  sleep 0.5
done
curl -sf -m 1 "http://localhost:$PORT/api/health" >/dev/null 2>&1 || die "backend did not become healthy"
ok "backend up on http://localhost:$PORT"

if [ "$DEV" = 1 ]; then
  say "starting the React dev server"
  (cd "$FRONTEND" && BROWSER=none setsid npm start >"$LOGS/frontend.log" 2>&1) &
  FPID=$!
  for i in $(seq 1 90); do curl -sf -m 1 http://localhost:3000/ >/dev/null 2>&1 && break; sleep 1; done
  URL="http://localhost:3000/#$TAB"
else
  URL="http://localhost:$PORT/#$TAB"
fi

# ---------------------------------------------------------------- is the glove really talking?
frames() { curl -s -m 2 "http://localhost:$PORT/api/device/status" | "$PY" -c "import sys,json; d=json.load(sys.stdin); f=d.get('latest_frame') or {}; print(d.get('frames_seen',0), 1 if d.get('connected') else 0, 1 if any(abs(x)>0.05 for x in (f.get('accel') or [0])) else 0)" 2>/dev/null; }
GLOVE_OK=0
if [ -n "$GLOVE" ]; then
  say "waiting for sensor frames"
  for i in $(seq 1 40); do
    read -r N CONN IMU <<<"$(frames)"
    if [ "${CONN:-0}" = 1 ] && [ "${N:-0}" -gt 25 ]; then GLOVE_OK=1; break; fi
    sleep 0.5
  done
  if [ "$GLOVE_OK" = 1 ]; then
    if [ "${IMU:-0}" = 1 ]; then ok "glove streaming (IMU live)"; else warn "glove streams but the IMU reads zero: check the IMU wires (SDA=D21, SCL=D22, 3V3, GND)"; fi
  else
    warn "no sensor frames yet: unplug and replug the glove, or press its EN button; the backend will reconnect by itself"
  fi
fi

# ---------------------------------------------------------------- browser
if [ "$OPEN" = 1 ]; then
  if command -v xdg-open >/dev/null && { [ -n "${WAYLAND_DISPLAY:-}" ] || [ -n "${DISPLAY:-}" ]; }; then
    xdg-open "$URL" >/dev/null 2>&1 &
    ok "opened $URL"
  else
    warn "no desktop session found; open $URL yourself"
  fi
fi

cat <<EOF

  Demo is running:  $URL
    Hand 3D        #hand3d    live hand model (rest flat for 1 s to re-centre the heading)
    Blocks 3D      #blocks    pinch to pick up, turn / pitch / twist to move
    Air Mouse      #airmouse  set up palm poses and fingers, then Enable
  Logs: $LOGS/backend.log        Stop: Ctrl+C here, or  ./run-demo.sh stop

EOF

# ---------------------------------------------------------------- supervise
while true; do
  if ! kill -0 "$BPID" 2>/dev/null; then
    warn "backend stopped; restarting it"
    (
      cd "$BACKEND" || exit 1
      GLOVE_AUTOOPEN=1 exec setsid "$PY" -m uvicorn app.main:app --host 0.0.0.0 --port "$PORT" \
        >>"$LOGS/backend.log" 2>&1
    ) &
    BPID=$!
    echo "$BPID" > "$LOGS/backend.pid"
    sleep 3
  fi
  sleep 2
done
