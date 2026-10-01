ALTER TABLE tickets ADD COLUMN sla_cycle INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tickets ADD COLUMN escalation_phase TEXT NOT NULL DEFAULT 'response';
ALTER TABLE ticket_messages ADD COLUMN reply_key TEXT;
CREATE UNIQUE INDEX reply_request_key ON ticket_messages(reply_key) WHERE reply_key IS NOT NULL;
ALTER TABLE notification_outbox ADD COLUMN dedupe_key TEXT;
ALTER TABLE notification_outbox ADD COLUMN line_retry_key TEXT;
ALTER TABLE notification_outbox ADD COLUMN lease_token TEXT;
ALTER TABLE notification_outbox ADD COLUMN first_attempt_at INTEGER;
ALTER TABLE notification_outbox ADD COLUMN line_sent_at INTEGER;
ALTER TABLE notification_outbox ADD COLUMN email_sent_at INTEGER;
CREATE UNIQUE INDEX outbox_dedupe ON notification_outbox(dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE TABLE api_requests(request_key TEXT PRIMARY KEY,actor_id TEXT NOT NULL,ticket_id TEXT NOT NULL,request_hash TEXT NOT NULL,message_id TEXT NOT NULL,outbox_id TEXT NOT NULL,created_at INTEGER NOT NULL);
ALTER TABLE integration_inbox ADD COLUMN state TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE integration_inbox ADD COLUMN next_attempt_at INTEGER NOT NULL DEFAULT 0;
UPDATE integration_inbox SET state='processed' WHERE processed_at IS NOT NULL;
CREATE TABLE line_unsends(account_key TEXT NOT NULL,message_id TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(account_key,message_id));
CREATE TABLE content_jobs(id TEXT PRIMARY KEY,ticket_id TEXT NOT NULL REFERENCES tickets(id),message_id TEXT NOT NULL UNIQUE,kind TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at INTEGER NOT NULL,lease_until INTEGER,lease_token TEXT,error TEXT,created_at INTEGER NOT NULL);
CREATE TABLE operation_audit(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,action TEXT NOT NULL,target_id TEXT,note TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE INDEX content_pending ON content_jobs(state,next_attempt_at);

ALTER TABLE tickets ADD COLUMN sla_started_at INTEGER;
UPDATE tickets SET sla_started_at=created_at;
UPDATE notification_outbox SET line_retry_key=retry_key WHERE length(retry_key)=36 AND substr(retry_key,9,1)='-';
UPDATE notification_outbox SET first_attempt_at=created_at WHERE attempts>0;

CREATE INDEX inbox_schedule ON integration_inbox(state,next_attempt_at,occurred_at);
CREATE INDEX outbox_leases ON notification_outbox(state,lease_until);
