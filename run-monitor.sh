#!/usr/bin/env bash
# Launch the ESP32 Monitor stack: backend API (:8000) + React UI (:3000).
# Usage: ./run-monitor.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"

# 1) Backend venv
if [ ! -x "$BACKEND/.venv/bin/python" ]; then
  echo "[setup] creating backend venv…"
  (cd "$BACKEND" && uv venv .venv --python 3.12 \
    && uv pip install --python .venv/bin/python \
       fastapi==0.115.6 uvicorn==0.34.0 sqlalchemy==2.0.36 \
       python-multipart==0.0.20 scikit-learn==1.6.1 numpy==2.2.2 \
       pydantic==2.10.4 requests pyserial)
fi

# 2) Backend
if ! curl -sf http://localhost:8000/ >/dev/null 2>&1; then
  echo "[run] backend on http://localhost:8000"
  (cd "$BACKEND" && .venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 &)
  sleep 2
else
  echo "[run] backend already up"
fi

# 3) Frontend
if [ ! -d "$FRONTEND/node_modules" ]; then
  echo "[setup] npm install…"
  (cd "$FRONTEND" && npm install)
fi
echo "[run] frontend on http://localhost:3000"
cd "$FRONTEND" && BROWSER=none npm start
