-- Caller addresses, the IP blocklist and counts of refused requests.
--   activity.ip          address of the caller of a check or a download (CF-Connecting-IP). Cleared with old checks.
--   activations.last_ip  address of the last check of the site
ALTER TABLE activity ADD COLUMN ip TEXT;
ALTER TABLE activations ADD COLUMN last_ip TEXT;

-- Addresses and ranges whose checks and downloads are refused with 403 before any licence is read.
--   value       canonical address or range: 203.0.113.5, 203.0.113.0/24, 2001:db8::/32
--   expires_at  NULL = until removed
--   hits        refused requests, counted approximately (batched in memory by each Worker instance)
CREATE TABLE ip_blocks (
  id TEXT PRIMARY KEY,
  value TEXT NOT NULL UNIQUE,
  reason TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  hits INTEGER NOT NULL DEFAULT 0,
  last_hit_at INTEGER
);

-- Requests refused before any licence is read, per UTC day: kind = blocked | rate_limited.
CREATE TABLE refused_requests (
  day INTEGER NOT NULL,
  kind TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind)
);
