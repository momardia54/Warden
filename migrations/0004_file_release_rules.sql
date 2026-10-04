-- Files are released by licence status instead of a fixed type: each file lists the statuses
-- it can be downloaded in (comma separated) and whether the site's domain must match.
ALTER TABLE files ADD COLUMN statuses TEXT NOT NULL DEFAULT 'active,completed';
ALTER TABLE files ADD COLUMN check_domain INTEGER NOT NULL DEFAULT 1;
UPDATE files SET statuses = 'completed', check_domain = 0 WHERE kind = 'final';
ALTER TABLE files DROP COLUMN kind;

-- activity.kind becomes activity.event: check | change | download
ALTER TABLE activity RENAME COLUMN kind TO event;
