-- Protection settings: rate limits and automatic blocking rules, edited in the dashboard.
--   settings.value       JSON; key 'protection' holds the rate limits, the rules and the never-block list
--   ip_blocks.source     manual | auto (created by a rule)
--   ip_events            unknown licence keys and rate-limit hits per address, read by the rules; kept one day
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

ALTER TABLE ip_blocks ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';

CREATE TABLE ip_events (
  ip TEXT NOT NULL,
  kind TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX idx_ip_events ON ip_events (ip, kind, at);

-- The rules count an address's recent checks.
CREATE INDEX idx_activity_ip_at ON activity (ip, at);
