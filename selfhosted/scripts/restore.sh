#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
backup_path="${1:?Usage: restore.sh backups/TIMESTAMP --confirm-replace}"
[[ "${2:-}" == '--confirm-replace' ]] || { echo 'Restore replaces current data; --confirm-replace required'; exit 1; }
backup_path="$(realpath "$backup_path")"
(cd "$backup_path" && sha256sum -c SHA256SUMS)
echo 'Writers will remain stopped after restore. Verify application version and schema before starting.'
docker compose stop gateway api worker scheduler
docker compose up -d db --wait
docker compose exec -T db pg_restore -U desk -d desk --clean --if-exists --no-owner --exit-on-error < "$backup_path/database.dump"
docker compose run --rm --no-deps -T api python -c 'import sys,tarfile,shutil,pathlib; root=pathlib.Path("/data/uploads"); [p.unlink() for p in root.iterdir() if p.is_file()]; t=tarfile.open(fileobj=sys.stdin.buffer,mode="r|*"); t.extractall("/data",filter="data")' < "$backup_path/uploads.tar"
echo 'Restore completed. Check commit.txt, restore matching config/secrets, then run make up and make smoke.'
