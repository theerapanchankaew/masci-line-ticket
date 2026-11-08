# Operations and recovery

## Pilot prerequisites
UPS, auto power-on after power restoration, wired network, SSD free-space monitoring and off-device encrypted backups. Start Docker on boot using supported host procedures. `restart: unless-stopped` restarts containers; explicitly stopped containers need an operator. One Mini PC has no HA. Choose RPO/RTO with service owners before customer operation.

## Daily checks
`make status`, `make smoke`, Operations page: worker/scheduler heartbeat within 120 seconds, queued/failed inbox, media/outbox failures, at-risk/breached tickets. Review unassigned work and agent availability/capacity. Review last off-device backup and free space. Do not log customer payloads or tokens. Docker log rotation is configured. External uptime checks should monitor readiness and notify a real operator.

## Secrets
Host secrets directory is 0700. Files 0444 allow non-root containers to read Compose-mounted files; host directory prevents unrelated host users traversing them. This is file access control, not encryption at rest. Protect disk/backups and restrict host admin access. Use `set-secret.py` to update credentials and recreate affected services. The database password and database_url must match; changing files alone does not change an existing PostgreSQL role password. Perform DB credential rotation as a planned operation.

## Deploy
Record current Git SHA and RELEASE, build/test on staging, then `make deploy`. Build completes before stopping service. Script backs up existing running DB, stops writers for migration, runs migration once, starts stack and smoke checks. If migration fails it leaves writers stopped. Do not run migrations in every API process. Initial schema is immutable; add numbered migrations for changes. Pin base images to tested digests for controlled production releases; current tagged base images are for pilot build convenience. No automatic production deployment on Git push.

## Backup
`make backup` stops gateway/API/worker/scheduler, dumps DB and archives uploads, restarts writers with an EXIT trap. This briefly interrupts ingress; schedule appropriately. Dumps + SHA256SUMS + commit SHA + nonsecret environment are in backups/TIMESTAMP. Copy them encrypted to a different device. Store credentials separately in an approved vault/protected recovery copy. A local backup on the same SSD does not protect against disk loss. No automatic retention/deletion is enabled. Set a backup schedule and retention plan on the host after testing; avoid overlapping deploy/backup/restore commands.

## Restore (replaces data)
Use a staging installation to prove recovery first. Ensure target environment and external callbacks are disabled, preserve current backup, match app commit/config/secrets and run:

```bash
bash scripts/restore.sh backups/TIMESTAMP --confirm-replace
```

Script verifies checksums, stops writers, restores DB/files and leaves writers stopped. Read commit.txt; checkout corresponding application version and restore correct secrets/config, then `make up` and `make smoke`. Restoring an older backup can reintroduce unsent or previously accepted outbox work: keep LINE_MODE=dry_run during assessment and reconcile with provider references before allowing live sends. Restore does not restore external LINE state.

## Rollback
Do not delete volumes. For backward-compatible migrations, checkout previous reviewed commit and set previous RELEASE image tag; bring up, check readiness and smoke. For incompatible schemas, restore a tested pre-deployment backup during a planned outage; all post-backup changes would be lost, so reconcile first. Never force a schema downgrade merely to make an older application start.

## Failed operations
Inbox: fix source problem and use retry button; retry keeps same event ID. Media: credentials/expired content/size cap can prevent recovery; ask customer to resend if unavailable. Outbox: inspect HTTP code; 401/403 -> credentials, 429 -> quota/rate. v0.1 intentionally has no generic resend button for ambiguous failed sends. An operator must reconcile provider acceptance and retry-key lifetime before any recovery. Stable retry UUID stops duplicate accepted requests within the provider's valid window; after that do not blindly generate a new key. Terminal simulated items never replay on live switch.

## Account recovery
An existing admin can reset passwords/deactivate users via PATCH /api/admin/users/{id}; affected sessions are revoked. Self-deactivation is blocked. No unattended password reset endpoint or default backdoor. Loss of all admin access requires a controlled DB maintenance procedure by an authorized administrator.

## Remaining production decisions
Approved service categories/teams/rosters, SLA targets and holidays, escalation contacts, privacy/retention handling, incident owner, backup frequency/RPO/RTO, quotas, test OA and production domain. Automatic antivirus, SSO and HA are outside this pilot.
