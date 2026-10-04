CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  cred TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE login_attempts (
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_login_attempts ON login_attempts (ip_hash, created_at);

-- status: pending | active | suspended | disabled | expired. "expired" is also reported when
-- expires_at has passed, even if the stored status is still "active".
CREATE TABLE licenses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  client TEXT NOT NULL DEFAULT '',
  license_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  expires_at INTEGER,
  domains TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_check_at INTEGER,
  last_check_domain TEXT,
  check_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_licenses_status ON licenses (status);

-- kind: check (a site asked for the status) | change (the owner edited the licence)
CREATE TABLE activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id TEXT NOT NULL REFERENCES licenses (id) ON DELETE CASCADE,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  status TEXT,
  domain TEXT,
  detail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_activity_license ON activity (license_id, at DESC);
CREATE INDEX idx_activity_at ON activity (at);
