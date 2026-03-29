#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

# Production (Railway): React build is pre-committed at frontend/build/
# and served as static files by FastAPI — no Node needed.
#
# Local dev: build the frontend if node_modules exist
if [ -d "$ROOT/frontend/node_modules" ]; then
  echo "Building frontend..."
  cd "$ROOT/frontend" && npm run build
fi

# Start backend (serves both API and the static React build)
echo "Starting on http://0.0.0.0:${PORT:-8000} ..."
cd "$ROOT/backend"
exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-8000}"
