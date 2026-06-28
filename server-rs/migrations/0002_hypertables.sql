-- TimescaleDB hypertables. Tables created empty in 0001; data loaded later via COPY.
-- Requires the timescaledb extension.

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- events: time=timestamp, space partition by site_id, 7-day chunks
SELECT create_hypertable(
    'events',
    'timestamp',
    partitioning_column => 'site_id',
    number_partitions => 4,
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists => TRUE,
    migrate_data => TRUE
);

-- sessions: started_at, 30-day chunks
SELECT create_hypertable(
    'sessions',
    'started_at',
    chunk_time_interval => INTERVAL '30 days',
    if_not_exists => TRUE,
    migrate_data => TRUE
);

-- heatmap_clicks: timestamp, 7-day chunks
SELECT create_hypertable(
    'heatmap_clicks',
    'timestamp',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists => TRUE,
    migrate_data => TRUE
);

-- heatmap_scrolls: timestamp, 7-day chunks
SELECT create_hypertable(
    'heatmap_scrolls',
    'timestamp',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists => TRUE,
    migrate_data => TRUE
);

-- session_recordings: started_at, 30-day chunks
SELECT create_hypertable(
    'session_recordings',
    'started_at',
    chunk_time_interval => INTERVAL '30 days',
    if_not_exists => TRUE,
    migrate_data => TRUE
);
