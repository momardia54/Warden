-- Apps: a product (for example a plugin or theme) sold to many customers. Licences can belong to an app;
-- licences without an app stay standalone.
CREATE TABLE apps (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  default_duration_days INTEGER,
  default_status TEXT NOT NULL DEFAULT 'active',
  default_max_sites INTEGER,
  default_message TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

ALTER TABLE licenses RENAME COLUMN client TO customer_name;
ALTER TABLE licenses ADD COLUMN customer_email TEXT NOT NULL DEFAULT '';
ALTER TABLE licenses ADD COLUMN app_id TEXT REFERENCES apps (id);
-- Maximum number of distinct sites (domains) the licence may be used on. NULL means unlimited.
ALTER TABLE licenses ADD COLUMN max_sites INTEGER;
CREATE INDEX idx_licenses_app ON licenses (app_id);

-- Domains a licence has been used on. A domain is registered on the first successful check.
CREATE TABLE activations (
  license_id TEXT NOT NULL REFERENCES licenses (id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  check_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (license_id, domain)
);

-- A file belongs either to one licence or to an app (shared by every licence of that app).
CREATE TABLE files_new (
  id TEXT PRIMARY KEY,
  license_id TEXT REFERENCES licenses (id) ON DELETE CASCADE,
  app_id TEXT REFERENCES apps (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  statuses TEXT NOT NULL DEFAULT 'active,completed',
  check_domain INTEGER NOT NULL DEFAULT 1,
  size INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  uploaded_at INTEGER NOT NULL,
  download_count INTEGER NOT NULL DEFAULT 0,
  last_download_at INTEGER,
  CHECK ((license_id IS NULL) <> (app_id IS NULL))
);
INSERT INTO files_new (id, license_id, name, version, notes, statuses, check_domain, size, content_type, r2_key, uploaded_at, download_count, last_download_at)
  SELECT id, license_id, name, version, notes, statuses, check_domain, size, content_type, r2_key, uploaded_at, download_count, last_download_at FROM files;
DROP TABLE files;
ALTER TABLE files_new RENAME TO files;
CREATE INDEX idx_files_license ON files (license_id, uploaded_at DESC);
CREATE INDEX idx_files_app ON files (app_id, uploaded_at DESC);
