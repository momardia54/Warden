-- Configurable licence statuses. app_id NULL is the default set used by every licence that has no app, and by
-- every app that has not defined its own set. An app can have its own set of statuses (rows with its app_id).
--   grants_access  1 if sites may run under this status (the check response has valid = true)
--   on_expiry      key of the status a licence moves to, as seen by sites, once its expiry date has passed
--   check_message  message returned to sites for this status when the licence has no public message of its own
--   is_default     the status new licences start with (exactly one per set)
CREATE TABLE statuses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id TEXT REFERENCES apps (id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  tone TEXT NOT NULL DEFAULT 'neutral',
  grants_access INTEGER NOT NULL DEFAULT 0,
  on_expiry TEXT,
  check_message TEXT NOT NULL DEFAULT '',
  is_default INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_statuses_scope_key ON statuses (COALESCE(app_id, ''), key);

INSERT INTO statuses (key, label, description, tone, grants_access, on_expiry, check_message, is_default, position) VALUES
  ('pending', 'Pending', 'Created but not in effect yet, for example before the first payment is received.', 'neutral', 0, NULL, 'This licence is not active yet.', 0, 1),
  ('active', 'Active', 'In effect. The site runs normally.', 'success', 1, 'expired', '', 1, 2),
  ('completed', 'Completed', 'Paid in full. Permanent: the expiry date no longer applies.', 'success', 1, NULL, '', 0, 3),
  ('suspended', 'Suspended', 'Temporarily on hold, for example for a late payment. Set to Active to resume.', 'warning', 0, NULL, 'This licence is suspended.', 0, 4),
  ('disabled', 'Disabled', 'Permanently switched off.', 'danger', 0, NULL, 'This licence has been disabled.', 0, 5),
  ('expired', 'Expired', 'Past its expiry date. Applied automatically to licences whose expiry date has passed.', 'danger', 0, NULL, 'This licence has expired.', 0, 6);
