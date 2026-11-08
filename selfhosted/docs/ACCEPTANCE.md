# Acceptance checklist — pilot, not a declaration of production readiness

## Automated
- Invalid signature/destination rejected; empty signed verification accepted.
- Duplicate webhook produces one message; idempotent create/reply requests.
- Team/task access isolation; server-side authorization; logout revokes sessions.
- Mapping suggestion and manual override; multiple Ticket source messages cannot mix customers.
- Capacity enforcement, transfer retains deadlines, stale version rejected.
- Required tasks block resolution; dependencies block premature completion.
- Customer postback requires same LINE user + current resolution token/status.
- Internal notes never queued to LINE; protected attachments; media unsend redaction.
- Business-day/holiday SLA; triage time included; snapshots immutable; alerts deduplicated.
- Provider retry key stable; 409 needs accepted-request reference; dry_run not replayed or counted as response.
- CI PostgreSQL runs concurrency tests; Compose builds and DB/files backup/restore smoke.

## On MASCI staging with actual test OA
- Verify HTTPS endpoint, outbound tunnel connectivity and OA config.
- Test actual text/image, multi-message follow-up, split issues and link existing case.
- Check correct Agent routing, paused availability, workload and multi-team tasks.
- Test live reply, resolve, confirm, reopen, stale button and blocked user behavior.
- Confirm account quota and notification text; no secrets in logs or Git.
- Restart Mini PC, API, Worker and Scheduler during queued work and reconcile results.
- UPS/power/network outage test, off-device backup and full restore to spare environment.
- Agree service policy, routing ownership, privacy/retention, escalation and incident response.

## Verification log for this delivery
See GitHub Actions for the exact branch/commit result. Local Python tests use SQLite when no TEST_DATABASE_URL is set; this does not prove PostgreSQL row-lock behavior. No live LINE credentials, Mini PC or production domain are available in this build environment. Do not describe local-only passing tests as a live deployment.
