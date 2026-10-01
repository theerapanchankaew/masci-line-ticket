CREATE TABLE IF NOT EXISTS masci_ticket_bridge_outbox (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  lease_until TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS masci_ticket_bridge_outbox_pending
  ON masci_ticket_bridge_outbox(status, next_attempt_at);
