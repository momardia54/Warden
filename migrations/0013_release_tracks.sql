-- Release tracks: what a set of licence statuses receives. An app or a standalone licence has any number of tracks;
-- each status belongs to at most one track of its owner, so a licence always receives updates from exactly one track.
-- A licence of an app can have tracks of its own: for the statuses they cover, they replace the app's tracks.
--   statuses      comma-separated status keys this track serves (exclusive within the owner)
--   check_domain  the domain check of the track's releases
-- A release (a file with a version) belongs to one track, whose statuses and domain check are copied onto the file
-- (files.statuses, files.check_domain) when the track changes, so availability is evaluated as before.
-- Files without a version (attachments) have no track and keep their own release rule.
CREATE TABLE release_tracks (
  id TEXT PRIMARY KEY,
  app_id TEXT REFERENCES apps (id) ON DELETE CASCADE,
  license_id TEXT REFERENCES licenses (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  statuses TEXT NOT NULL DEFAULT '',
  check_domain INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK ((app_id IS NULL) <> (license_id IS NULL))
);
CREATE INDEX idx_release_tracks_app ON release_tracks (app_id);
CREATE INDEX idx_release_tracks_license ON release_tracks (license_id);

ALTER TABLE files ADD COLUMN track_id TEXT REFERENCES release_tracks (id);
CREATE INDEX idx_files_track ON files (track_id);

-- A repository now publishes into a track. An owner can connect several repositories (one per track), and the same
-- repository more than once, told apart by the tag prefix (for example "" for v1.4.0 and "final-" for final-v1.4.0).
ALTER TABLE release_sources ADD COLUMN track_id TEXT REFERENCES release_tracks (id);
ALTER TABLE release_sources ADD COLUMN tag_prefix TEXT NOT NULL DEFAULT '';
DROP INDEX idx_release_sources_app;
DROP INDEX idx_release_sources_license;
CREATE INDEX idx_release_sources_app ON release_sources (app_id);
CREATE INDEX idx_release_sources_license ON release_sources (license_id);
CREATE UNIQUE INDEX idx_release_sources_track ON release_sources (track_id) WHERE track_id IS NOT NULL;

-- Existing releases: one track per owner and distinct release rule, so nobody gains or loses access. An owner with a
-- single rule gets one track named "Releases", otherwise each track is named after its statuses. Overlapping
-- statuses that result are reported in the dashboard.
INSERT INTO release_tracks (id, app_id, license_id, name, statuses, check_domain, position, created_at, updated_at)
SELECT
  'trk_' || lower(hex(randomblob(10))),
  g.app_id,
  g.license_id,
  CASE WHEN g.rules = 1 THEN 'Releases' ELSE 'Releases for ' || replace(g.statuses, ',', ', ') END,
  g.statuses,
  g.check_domain,
  g.position,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM (
  SELECT
    r.app_id, r.license_id, r.statuses, r.check_domain,
    COUNT(*) OVER (PARTITION BY r.app_id, r.license_id) AS rules,
    ROW_NUMBER() OVER (PARTITION BY r.app_id, r.license_id ORDER BY r.statuses, r.check_domain) AS position
  FROM (SELECT DISTINCT app_id, license_id, statuses, check_domain FROM files WHERE version <> '') r
) g;

UPDATE files SET track_id = (
  SELECT t.id FROM release_tracks t
  WHERE t.app_id IS files.app_id AND t.license_id IS files.license_id AND t.statuses = files.statuses AND t.check_domain = files.check_domain
)
WHERE version <> '';

-- Connected repositories: into the track with the same rule, or a track of their own.
INSERT INTO release_tracks (id, app_id, license_id, name, statuses, check_domain, position, created_at, updated_at)
SELECT
  'trk_' || lower(hex(randomblob(10))),
  s.app_id, s.license_id, 'From ' || s.repository, s.statuses, s.check_domain,
  100,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM release_sources s
WHERE NOT EXISTS (
  SELECT 1 FROM release_tracks t
  WHERE t.app_id IS s.app_id AND t.license_id IS s.license_id AND t.statuses = s.statuses AND t.check_domain = s.check_domain
);

UPDATE release_sources SET track_id = (
  SELECT t.id FROM release_tracks t
  WHERE t.app_id IS release_sources.app_id AND t.license_id IS release_sources.license_id
    AND t.statuses = release_sources.statuses AND t.check_domain = release_sources.check_domain
  ORDER BY t.position LIMIT 1
);
