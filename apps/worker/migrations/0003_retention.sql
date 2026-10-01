ALTER TABLE tickets ADD COLUMN retention_state TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE tickets ADD COLUMN retention_processed_at INTEGER;
CREATE INDEX retention_closed ON tickets(retention_state,closed_at);
