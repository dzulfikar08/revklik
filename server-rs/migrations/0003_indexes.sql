-- Indexes for hypertables (created after schema; chunk-local). Mirror D1 indexes.

CREATE INDEX IF NOT EXISTS idx_events_site_time       ON events (site_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_events_site_session    ON events (site_id, session_id);
CREATE INDEX IF NOT EXISTS idx_events_site_visitor    ON events (site_id, visitor_id);
CREATE INDEX IF NOT EXISTS idx_events_site_type       ON events (site_id, event_type, timestamp);
CREATE INDEX IF NOT EXISTS idx_events_site_name_time  ON events (site_id, name, timestamp);
CREATE INDEX IF NOT EXISTS idx_events_site_path       ON events (site_id, path);
CREATE INDEX IF NOT EXISTS idx_events_fingerprint     ON events (site_id, fingerprint);
CREATE INDEX IF NOT EXISTS idx_events_site_revenue    ON events (site_id, revenue, timestamp);
CREATE INDEX IF NOT EXISTS idx_events_site_payment    ON events (site_id, payment_provider, payment_method, timestamp);

CREATE INDEX IF NOT EXISTS idx_sessions_site         ON sessions (site_id, started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_visitor      ON sessions (site_id, visitor_id);
CREATE INDEX IF NOT EXISTS idx_sessions_fingerprint  ON sessions (site_id, fingerprint);

CREATE INDEX IF NOT EXISTS idx_hmc_site_path ON heatmap_clicks (site_id, path, timestamp);
CREATE INDEX IF NOT EXISTS idx_hmc_site_time ON heatmap_clicks (site_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_hms_site_path ON heatmap_scrolls (site_id, path, timestamp);

CREATE INDEX IF NOT EXISTS idx_sr_site    ON session_recordings (site_id, started_at);
CREATE INDEX IF NOT EXISTS idx_sr_session ON session_recordings (session_id);
