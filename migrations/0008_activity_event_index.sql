-- Traffic analytics read one kind of event over a period (checks, or downloads). With this index a query reads
-- only the rows of that kind instead of every event of the period. It also serves the daily deletion of old checks.
CREATE INDEX IF NOT EXISTS idx_activity_event_at ON activity (event, at);
