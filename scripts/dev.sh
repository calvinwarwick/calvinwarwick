#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
pip install -e ".[dev]" >/tmp/bfclips-pip.log

(
  cd frontend
  if [[ ! -d node_modules ]]; then
    npm install
  fi
  npm run dev
) &
UI_PID=$!
trap 'kill '"$UI_PID"' 2>/dev/null || true' EXIT

python -m bfclips serve
