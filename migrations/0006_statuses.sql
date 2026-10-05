-- Configurable licence statuses. The built-in default statuses are defined in the application and need no rows.
-- An app can define its own statuses, and so can a single licence. The statuses a licence uses are, in order:
-- its own, its app's, the built-in defaults.
--   color          badge colour as a hex value, for example #16a34a
--   grants_access  1 if sites may run under this status (the check response has valid = true)
--   on_expiry      key of the status a licence takes on, as seen by sites, once its expiry date has passed
--   check_message  message returned to sites for this status when the licence has no public message of its own
--   is_default     the status new licences start with (exactly one per set)
CREATE TABLE statuses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id TEXT REFERENCES apps (id) ON DELETE CASCADE,
  license_id TEXT REFERENCES licenses (id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#6b7280',
  grants_access INTEGER NOT NULL DEFAULT 0,
  on_expiry TEXT,
  check_message TEXT NOT NULL DEFAULT '',
  is_default INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL,
  CHECK ((app_id IS NULL) <> (license_id IS NULL))
);
CREATE UNIQUE INDEX idx_statuses_app_key ON statuses (app_id, key) WHERE app_id IS NOT NULL;
CREATE UNIQUE INDEX idx_statuses_license_key ON statuses (license_id, key) WHERE license_id IS NOT NULL;
