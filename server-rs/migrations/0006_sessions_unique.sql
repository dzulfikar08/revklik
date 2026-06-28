-- No-op placeholder.
-- Originally tried: CREATE UNIQUE INDEX (site_id, id) on sessions to enable
-- ON CONFLICT upsert. Timescale rejects any unique index that omits the
-- partitioning column (started_at). The track batch now splits sessions into
-- INSERT-new / UPDATE-existing using a prior id lookup, so no index is needed.
SELECT 1;
