#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
command -v docker >/dev/null
[[ -f .env && -s secrets/database_url ]] || { echo 'Run python3 scripts/init.py first'; exit 1; }
docker compose config --quiet
# Build before downtime; retain previous Git commit and image tag for rollback.
docker compose build
if docker compose ps --status running --services | grep -qx db; then
  bash scripts/backup.sh
fi
docker compose up -d db --wait
# Stop writers before migrations; do not auto-restore DB on deployment failure.
docker compose stop gateway api worker scheduler
if ! docker compose run --rm --no-deps migrate; then
  echo 'Migration failed. Writers remain stopped. Follow recovery runbook.' >&2
  exit 1
fi
docker compose up -d --wait
bash scripts/smoke-test.sh
