-- Files attached to a licence, stored in R2 (binding FILES). kind: update (downloadable while the licence
-- is in force: active or completed) | final (downloadable only once the licence is completed, paid in full).
CREATE TABLE files (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL REFERENCES licenses (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  uploaded_at INTEGER NOT NULL,
  download_count INTEGER NOT NULL DEFAULT 0,
  last_download_at INTEGER
);
CREATE INDEX idx_files_license ON files (license_id, uploaded_at DESC);
