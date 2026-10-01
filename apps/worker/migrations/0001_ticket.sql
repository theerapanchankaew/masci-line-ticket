PRAGMA foreign_keys = ON;
CREATE TABLE teams(id TEXT PRIMARY KEY, name TEXT NOT NULL, policy_json TEXT NOT NULL);
CREATE TABLE staff(id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','supervisor','agent')), team_id TEXT NOT NULL REFERENCES teams(id), line_user_id TEXT, active INTEGER NOT NULL DEFAULT 0 CHECK(active IN(0,1)));
CREATE TABLE tickets(
 id TEXT PRIMARY KEY, number TEXT UNIQUE NOT NULL, account_key TEXT NOT NULL, customer_id TEXT NOT NULL, subject TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'general', status TEXT NOT NULL CHECK(status IN ('new','assigned','in_progress','waiting_customer','resolved','closed','cancelled')),
 team_id TEXT NOT NULL REFERENCES teams(id), assignee_id TEXT REFERENCES staff(id), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, response_due INTEGER NOT NULL, resolution_due INTEGER NOT NULL, first_response_at INTEGER, resolved_at INTEGER, closed_at INTEGER,
 version INTEGER NOT NULL DEFAULT 1, escalation_level INTEGER NOT NULL DEFAULT 0, next_escalation_at INTEGER NOT NULL, sla_breached INTEGER NOT NULL DEFAULT 0, policy_json TEXT NOT NULL, last_operation_id TEXT);
CREATE INDEX tickets_due ON tickets(status,next_escalation_at);
CREATE INDEX tickets_customer ON tickets(account_key,customer_id,created_at DESC);
CREATE INDEX tickets_queue ON tickets(team_id,status,updated_at DESC);
CREATE TABLE ticket_messages(id TEXT PRIMARY KEY,ticket_id TEXT NOT NULL REFERENCES tickets(id),source_id TEXT UNIQUE,direction TEXT NOT NULL,kind TEXT NOT NULL,content TEXT NOT NULL,state TEXT NOT NULL,created_at INTEGER NOT NULL,actor_id TEXT REFERENCES staff(id));
CREATE INDEX ticket_messages_ticket ON ticket_messages(ticket_id,created_at);
CREATE TABLE ticket_events(id TEXT PRIMARY KEY,ticket_id TEXT NOT NULL REFERENCES tickets(id),action TEXT NOT NULL,actor_id TEXT NOT NULL,note TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE INDEX ticket_events_ticket ON ticket_events(ticket_id,created_at);
CREATE TABLE action_tokens(hash TEXT PRIMARY KEY,ticket_id TEXT NOT NULL REFERENCES tickets(id),actor_id TEXT NOT NULL REFERENCES staff(id),action TEXT NOT NULL,version INTEGER NOT NULL,expires_at INTEGER NOT NULL,used_at INTEGER);
CREATE TABLE integration_inbox(id TEXT PRIMARY KEY,account_key TEXT NOT NULL,payload TEXT NOT NULL,occurred_at INTEGER NOT NULL,received_at INTEGER NOT NULL,processed_at INTEGER,attempts INTEGER NOT NULL DEFAULT 0,error TEXT);
CREATE INDEX inbox_pending ON integration_inbox(processed_at,occurred_at);
CREATE TABLE notification_outbox(id TEXT PRIMARY KEY,ticket_id TEXT NOT NULL REFERENCES tickets(id),kind TEXT NOT NULL CHECK(kind IN ('alert','reply')),recipient_id TEXT,payload TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN('pending','sending','sent','cancelled','failed','uncertain')),attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at INTEGER NOT NULL,lease_until INTEGER,retry_key TEXT NOT NULL UNIQUE,created_at INTEGER NOT NULL,sent_at INTEGER,error TEXT);
CREATE INDEX outbox_pending ON notification_outbox(state,next_attempt_at);
CREATE TABLE attachments(id TEXT PRIMARY KEY,ticket_id TEXT NOT NULL REFERENCES tickets(id),object_key TEXT NOT NULL,name TEXT NOT NULL,size INTEGER NOT NULL,mime TEXT NOT NULL,actor_id TEXT NOT NULL,created_at INTEGER NOT NULL);
INSERT INTO teams VALUES('service','Customer Service','{"responseMinutes":30,"resolutionMinutes":240,"escalationMinutes":60,"maxLevel":2,"businessHours":false,"startHour":9,"endHour":17,"holidays":[]}');

CREATE TABLE customer_links(account_key TEXT NOT NULL,customer_id TEXT NOT NULL,line_user_id TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(account_key,customer_id));
CREATE UNIQUE INDEX one_open_ticket_per_customer ON tickets(account_key,customer_id) WHERE status IN('new','assigned','in_progress','waiting_customer');
