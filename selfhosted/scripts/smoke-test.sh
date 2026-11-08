#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose exec -T api python - <<'CHECK'
import urllib.request,json
for path in ('live','ready'):
    data=json.load(urllib.request.urlopen('http://localhost:8000/health/'+path,timeout=5))
    assert data['status'] in ('ok','ready'),data
print('API liveness, database migration and readiness checks passed.')
CHECK
docker compose exec -T gateway wget -q -O /dev/null http://127.0.0.1:8080/
docker compose exec -T gateway wget -q -O /dev/null http://127.0.0.1:8080/health/ready
for service_name in worker scheduler; do
  [[ -n "$(docker compose ps --status running -q "$service_name")" ]]
done
echo 'Web, gateway, worker and scheduler smoke checks passed.'
