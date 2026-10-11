-- Grace period: days a licence stays valid after its expiry date before its status's expiry rule takes effect.
--   apps.grace_days       applies to every licence of the app that has no setting of its own (NULL: none)
--   licenses.grace_days   the licence's own setting, overriding its app's (NULL: the app's; 0: none)
ALTER TABLE apps ADD COLUMN grace_days INTEGER;
ALTER TABLE licenses ADD COLUMN grace_days INTEGER;

-- Outgoing webhooks: URLs called when something happens to a licence.
--   events   comma-separated event types the endpoint receives
CREATE TABLE webhooks (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  events TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- One row per event and endpoint (an outbox): written with the change, sent right after it and retried by the
-- scheduled run. state: pending (due at next_attempt_at), sending (claimed until next_attempt_at), delivered, failed.
CREATE TABLE webhook_deliveries (
  id TEXT PRIMARY KEY,
  webhook_id TEXT NOT NULL REFERENCES webhooks (id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  event TEXT NOT NULL,
  license_id TEXT,
  payload TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  last_status INTEGER,
  last_error TEXT NOT NULL DEFAULT '',
  last_attempt_at INTEGER,
  created_at INTEGER NOT NULL,
  delivered_at INTEGER
);
CREATE INDEX idx_webhook_deliveries_due ON webhook_deliveries (state, next_attempt_at);
CREATE INDEX idx_webhook_deliveries_webhook ON webhook_deliveries (webhook_id, created_at);

-- Time-based events (grace period started, expired, no recent check) are found by the scheduled run. These columns
-- hold the value each event was last reported for (the expiry date, or the time of the last check), so each fires once.
ALTER TABLE licenses ADD COLUMN grace_notified_for INTEGER;
ALTER TABLE licenses ADD COLUMN expired_notified_for INTEGER;
ALTER TABLE licenses ADD COLUMN silent_notified_for INTEGER;

-- What has already happened before this version is not reported.
UPDATE licenses SET grace_notified_for = expires_at, expired_notified_for = expires_at
  WHERE expires_at IS NOT NULL AND expires_at <= CAST(strftime('%s', 'now') AS INTEGER) * 1000;
UPDATE licenses SET silent_notified_for = COALESCE(last_check_at, created_at)
  WHERE COALESCE(last_check_at, created_at) < (CAST(strftime('%s', 'now') AS INTEGER) - 3 * 86400) * 1000;
