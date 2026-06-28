-- Continuous aggregates + referrer source generated column + retention.
-- Timescale Toolkit (1.23) API: hyperloglog(size, val) builds HLL state (stored in
-- cagg for hierarchical rollup), rollup(hll) merges across buckets, distinct_count(hll)
-- reads the approximate count. size=12 ~= 1% error. Pageviews/conversions/revenue are
-- exact and additive. Idempotent (IF NOT EXISTS).

CREATE EXTENSION IF NOT EXISTS timescaledb_toolkit;

-- Referrer source as a STORED generated column.
-- Port of the TS sourceSql CASE (queries/analytics.ts): host extraction via split_part
-- (Postgres equivalent of the SQLite INSTR/SUBSTR gymnastics).
-- IF NOT EXISTS: the events_hourly cagg depends on this column, so never drop it.
ALTER TABLE events ADD COLUMN IF NOT EXISTS source TEXT GENERATED ALWAYS AS (
  COALESCE(
    utm_source,
    CASE
      WHEN referrer IS NULL OR referrer = '' THEN 'direct'
      WHEN referrer ILIKE '%ig_text_post_permalink%' OR referrer ILIKE '%ig_text_feed_timeline%' THEN 'instagram'
      ELSE (
        CASE LOWER(regexp_replace(split_part(split_part(referrer, '://', 2), '/', 1), '^www\.', ''))
          WHEN 'l.threads.com'  THEN 'threads'
          WHEN 'threads.net'    THEN 'threads'
          WHEN 'm.facebook.com' THEN 'facebook'
          WHEN 'facebook.com'   THEN 'facebook'
          WHEN 'fb.me'          THEN 'facebook'
          WHEN 't.co'           THEN 'twitter'
          WHEN 'instagram.com'  THEN 'instagram'
          ELSE LOWER(regexp_replace(split_part(split_part(referrer, '://', 2), '/', 1), '^www\.', ''))
        END
      )
    END
  )
) STORED;

-- Hourly events rollup. Serves overview stats, hourly+daily timeseries, revenue
-- timeseries, and the SSE polling feed. Daily = rollup over hourly with
-- time_bucket('1 day', bucket). visitors stored as HLL state (approximate ~1%).
CREATE MATERIALIZED VIEW IF NOT EXISTS events_hourly
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', timestamp) AS bucket,
    site_id,
    source,
    count(*) FILTER (WHERE event_type = 'pageview')   AS pageviews,
    hyperloglog(12, visitor_id) FILTER (WHERE event_type = 'pageview') AS visitors_hll,
    count(*) FILTER (WHERE event_type = 'conversion') AS conversions,
    sum(revenue)                                      AS revenue
FROM events
GROUP BY 1, 2, 3
WITH NO DATA;

SELECT add_continuous_aggregate_policy(
    'events_hourly',
    start_offset      => INTERVAL '3 days',
    end_offset        => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour',
    if_not_exists     => TRUE
);

-- Daily sessions rollup (bounce rate + session counts). is_bounce::int for avg.
CREATE MATERIALIZED VIEW IF NOT EXISTS sessions_daily
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 day', started_at) AS bucket,
    site_id,
    count(*)                          AS sessions,
    hyperloglog(12, visitor_id)       AS visitors_hll,
    avg((is_bounce)::int)             AS bounce_rate
FROM sessions
GROUP BY 1, 2
WITH NO DATA;

SELECT add_continuous_aggregate_policy(
    'sessions_daily',
    start_offset      => INTERVAL '4 days',
    end_offset        => INTERVAL '1 day',
    schedule_interval => INTERVAL '1 hour',
    if_not_exists     => TRUE
);

-- Backfill: run AFTER migrations (refresh_continuous_aggregate cannot run inside a
-- transaction, and sqlx wraps each migration file in one). See main.rs::refresh_caggs().

-- Retention: global 90-day drop_chunks on raw hypertables (max plan retention).
-- Per-plan range capping happens at query time in the app.
SELECT add_retention_policy('events',             INTERVAL '90 days', if_not_exists => TRUE);
SELECT add_retention_policy('sessions',           INTERVAL '90 days', if_not_exists => TRUE);
SELECT add_retention_policy('heatmap_clicks',     INTERVAL '90 days', if_not_exists => TRUE);
SELECT add_retention_policy('heatmap_scrolls',    INTERVAL '90 days', if_not_exists => TRUE);
SELECT add_retention_policy('session_recordings', INTERVAL '90 days', if_not_exists => TRUE);
