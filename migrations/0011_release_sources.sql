-- Release sources: a repository connected to an app or a licence. When the source's trigger fires (a new tag),
-- Warden downloads the repository archive at that point, repacks it and publishes it as a release of the owner.
--   provider        the hosting service, for example github; the code holds the list of supported providers
--   repository      the repository on that service, for example harbor-studio/harbor-theme
--   trigger         what publishes a release, for example tag (a new tag; its name is the version)
--   package_folder  the top-level folder inside the published zip, so updates always install into the same folder
--   statuses        release rule of the imported releases: comma-separated status keys, as on files
--   token           access token for a private repository ('' for a public one). Never returned by the API or dashboard
--   webhook_secret  shared secret that signs the provider's webhook deliveries
--   options         JSON object for provider- or trigger-specific settings added later
CREATE TABLE release_sources (
  id TEXT PRIMARY KEY,
  app_id TEXT REFERENCES apps (id) ON DELETE CASCADE,
  license_id TEXT REFERENCES licenses (id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  repository TEXT NOT NULL,
  trigger TEXT NOT NULL DEFAULT 'tag',
  package_folder TEXT NOT NULL,
  statuses TEXT NOT NULL,
  check_domain INTEGER NOT NULL DEFAULT 1,
  token TEXT NOT NULL DEFAULT '',
  webhook_secret TEXT NOT NULL,
  options TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_delivery_at INTEGER,
  CHECK ((app_id IS NULL) <> (license_id IS NULL))
);
CREATE UNIQUE INDEX idx_release_sources_app ON release_sources (app_id) WHERE app_id IS NOT NULL;
CREATE UNIQUE INDEX idx_release_sources_license ON release_sources (license_id) WHERE license_id IS NOT NULL;

-- One row per reference (tag) a source was asked to publish. The unique key makes repeated webhook deliveries harmless.
--   state  pending | imported | skipped | failed
--   detail why it was skipped or failed, or what was published
CREATE TABLE source_imports (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES release_sources (id) ON DELETE CASCADE,
  ref TEXT NOT NULL,
  commit_sha TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  file_id TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  UNIQUE (source_id, ref)
);
CREATE INDEX idx_source_imports_source ON source_imports (source_id, started_at);
