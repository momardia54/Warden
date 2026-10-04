-- API keys. Only a SHA-256 of the key is stored; the key itself is shown once, when it is created.
-- scope: read (GET only) < manage (create, edit, status, renew) < full (also delete and regenerate keys)
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL DEFAULT 'manage',
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);

-- Your own reference for a licence (an order id, an invoice number). Creating twice with the same
-- reference through the API returns the first licence instead of making a duplicate.
ALTER TABLE licenses ADD COLUMN external_ref TEXT;
CREATE UNIQUE INDEX idx_licenses_external_ref ON licenses (external_ref) WHERE external_ref IS NOT NULL;
