# MASCI Service Desk self-hosted v0.1

## Boundaries
Standalone stack in `selfhosted/`; does not migrate Cloudflare D1/R2 data or replace the existing edge application. Uses direct LINE Messaging API and a new webhook endpoint. No L Harness dependency. One configured LINE OA per installation; one-to-one user chats only. Root LICENSE/NOTICE remain applicable.

## Execution
Webhook -> verified raw-body signature -> database inbox commit -> HTTP 200. Worker consumes events under PostgreSQL row locks with SKIP LOCKED. Messages remain unlinked in triage until a dispatcher links them to existing tickets or creates tickets. Mapping rules suggest a team/policy/priority; dispatcher reviews the decision. Scheduler dispatches already-created queued tickets in priority/deadline/arrival order, using active, available agents in the selected team and combined Ticket+Task capacity. Agent records currently support one team; skills, rosters, acceptance deadlines and automatic task templates are future extensions.

All business mutations run in database transactions. Ticket row locks plus optimistic versions reject stale requests. Command keys prevent duplicate ticket creation/reply submission. Stable LINE retry UUID protects provider retries. Transactions containing outbound calls hold the outbox lock for a bounded call; retain same request key after crash. No exactly-once delivery claim: ambiguous old requests require operator investigation. No text or tokens logged.

## Security
Argon2 password hashes; opaque 8h sessions, SHA256 hashes stored in DB; bearer token in browser memory only. Reload requires login. Role checks and ticket/team/task access checks on the server. Internal notes never enter outgoing messages. Per-account throttling plus gateway rate limits. Do not expose raw API port; database has no published port. Non-root app containers. Token/secret files are mounted read-only, not baked into images. Host secrets directory must remain 0700. Admin bootstrapping is explicit, one time, with no default password.

## SLA policy
Pilot values are examples, not MASCI-approved commitments. Clock starts at server receipt of the earliest source message, not ticket creation. Bangkok business hours, weekdays and explicit holiday list; P1-P4 have response/resolution minutes and immutable snapshots. Waiting_customer counts time; no pause in v0.1. Transfer and reopen retain original deadlines. Resolution round history is in audit; reopening clears resolved_at and increments round. First substantive accepted reply/resolution satisfies response target; acknowledgements and dry-run messages do not. Automatic dispatch directly assigns an owner; there is no accept/reject stage yet. At-risk means <=30 wall-clock minutes before deadline, not 30 business minutes. Alerts appear on Operations, not external supervisor notifications. Case is represented by ticket number/customer link; separate multi-ticket Case entity is deferred.

## Known scope boundaries
Inbound non-text message references are captured and media download jobs fetch up to 10 MB (when credentials are configured). Staff can attach protected evidence files. No customer LIFF portal, CRM identity matching, automatic close, SSO, AI, antivirus, HA or edge-to-selfhosted migration in v0.1. Customer status and resolve confirmation use LINE postback. Unsend redacts retained message text and downloaded media; tickets and staff-authored summaries need a retention/redaction procedure. Raw pending webhook payloads contain customer content; restrict DB access. Add retention policy before production and monitor disk usage.

## Reliability and operations
Single Mini PC is a single point of failure. UPS, monitored internet, disk alerts and off-device encrypted backups required for pilot acceptance. DB connection failures return non-200 so redelivery can retry; LINE redelivery is bounded and not a durable external queue. Outage tolerance requires an external ingress in a later release. Status accepted only means provider API accepted request, not customer read/delivery. Dry-run outbox is terminal simulated and never replayed when switching live. Backup quiesces writers for matching DB/files snapshots; restore is explicit and leaves writers stopped. Container restart is not a substitute for an external uptime monitor.

## Primary references
- https://developers.line.biz/en/docs/messaging-api/receiving-messages/
- https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/
- https://developers.line.biz/en/docs/messaging-api/retrying-api-request/
- https://docs.docker.com/compose/how-tos/use-secrets/
- https://www.postgresql.org/docs/16/app-pgdump.html
