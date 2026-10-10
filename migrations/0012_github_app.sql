-- Release sources connected through the install's GitHub App instead of a token and a per-source webhook.
--   installation_id  the GitHub App installation that gives access to the repository; NULL for a source connected with a token
--   repository_id    the provider's numeric id of the repository, which stays the same when the repository is renamed
-- The GitHub App's own credentials are stored in settings under the key 'github_app'.
ALTER TABLE release_sources ADD COLUMN installation_id INTEGER;
ALTER TABLE release_sources ADD COLUMN repository_id INTEGER;
CREATE INDEX idx_release_sources_repository ON release_sources (provider, repository_id);
