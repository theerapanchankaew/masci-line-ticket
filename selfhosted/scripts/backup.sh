#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
chmod 700 backups
backup_path="backups/$(date -u +%Y%m%dT%H%M%SZ)-$RANDOM"
mkdir -m 700 "$backup_path"
# Quiesce all writers so database and upload files refer to one consistent state.
docker compose stop gateway api worker scheduler
trap 'docker compose up -d api worker scheduler gateway >/dev/null' EXIT
docker compose exec -T db pg_dump -U desk -d desk -Fc > "$backup_path/database.dump"
docker compose run --rm --no-deps -T api python -c 'import tarfile,sys; t=tarfile.open(fileobj=sys.stdout.buffer,mode="w|"); t.add("/data/uploads",arcname="uploads"); t.close()' > "$backup_path/uploads.tar"
[[ -s "$backup_path/database.dump" && -s "$backup_path/uploads.tar" ]]
git rev-parse HEAD > "$backup_path/commit.txt"
cp .env "$backup_path/environment.txt"
chmod 600 "$backup_path/"*
(cd "$backup_path" && sha256sum database.dump uploads.tar commit.txt environment.txt > SHA256SUMS)
echo "Backup complete: $backup_path. Copy encrypted to a separate device. secrets/ requires a separate protected recovery copy."
