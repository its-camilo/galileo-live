#!/usr/bin/env bash
# Deploys the FastAPI backend from this repo to the VPS runtime dir (default /data/galileo-live).
# Secrets live in $ROOT/.env (never in the repo). Run from anywhere: ./deploy/deploy_vps.sh
set -euo pipefail

ROOT="${GALILEO_ROOT:-/data/galileo-live}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"

mkdir -p "$ROOT/bin" "$ROOT/data"
if [ ! -x "$ROOT/venv/bin/python" ]; then
  python3 -m venv "$ROOT/venv"
fi
"$ROOT/venv/bin/pip" install -q -r "$REPO/api/requirements.txt"

rm -rf "$ROOT/app"
cp -r "$REPO/api/app" "$ROOT/app"
find "$ROOT/app" -name __pycache__ -type d -exec rm -rf {} +

install -m 644 "$REPO/deploy/galileo-live-api.service" "$HOME/.config/systemd/user/galileo-live-api.service"
systemctl --user daemon-reload
systemctl --user enable galileo-live-api.service >/dev/null
systemctl --user restart galileo-live-api.service
systemctl --user --no-pager status galileo-live-api.service | head -5
