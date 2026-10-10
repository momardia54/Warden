-- Releases and updates. A file with a version is a release; files without one are attachments.
--   channel       stable | beta. Beta releases are offered only to sites that ask for the beta channel.
--   changelog     public release notes, returned with the release to sites and in the download list
--   sha256        hex SHA-256 of the stored file, computed during the upload ('' for files uploaded before this migration)
--   withdrawn_at  set when a release is withdrawn: it is no longer offered or downloadable, but stays on record
ALTER TABLE files ADD COLUMN channel TEXT NOT NULL DEFAULT 'stable';
ALTER TABLE files ADD COLUMN changelog TEXT NOT NULL DEFAULT '';
ALTER TABLE files ADD COLUMN sha256 TEXT NOT NULL DEFAULT '';
ALTER TABLE files ADD COLUMN withdrawn_at INTEGER;

-- The version a site last reported with its check (?version=). NULL when it never sent one.
ALTER TABLE activations ADD COLUMN version TEXT;
