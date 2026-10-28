-- Imports from a repository run in steps that survive a stopped Worker: the archive is downloaded into R2, repacked
-- part by part into the release's file, then recorded. Each step records its progress, and the scheduled run resumes
-- an import whose Worker stopped (for example at the CPU limit of the free plan) from the last step completed.
--   stage           '' (download), repack (archive_size known, parts being written), store (package complete)
--   upload_id       the R2 multipart upload in progress for the current stage, '' when none
--   package_key     the R2 key of the release's file being written (file_id holds its future id), '' before repack
--   parts           JSON list of the parts of the package uploaded so far ({ partNumber, etag })
--   archive_size    size of the downloaded archive
--   attempts        runs started since the import last made progress
--   claimed_until   a run holds the import until then; after it, the scheduled run may resume it
ALTER TABLE source_imports ADD COLUMN stage TEXT NOT NULL DEFAULT '';
ALTER TABLE source_imports ADD COLUMN upload_id TEXT NOT NULL DEFAULT '';
ALTER TABLE source_imports ADD COLUMN package_key TEXT NOT NULL DEFAULT '';
ALTER TABLE source_imports ADD COLUMN parts TEXT NOT NULL DEFAULT '[]';
ALTER TABLE source_imports ADD COLUMN archive_size INTEGER;
ALTER TABLE source_imports ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE source_imports ADD COLUMN claimed_until INTEGER;
CREATE INDEX idx_source_imports_pending ON source_imports (state, claimed_until);
