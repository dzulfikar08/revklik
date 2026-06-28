-- GIN indexes for jsonb containment queries + payment idempotency table.

-- jsonb_path_ops GIN: smaller/faster for @> containment (webhook/payment dedup).
CREATE INDEX IF NOT EXISTS idx_events_props_gin ON events USING GIN (props jsonb_path_ops);

-- Dedicated idempotency table for server-side payment tracking (replaces the old
-- props LIKE '%"transaction_id":"x"%' dedup, which was a seq scan + collision-prone).
CREATE TABLE IF NOT EXISTS payment_events (
    site_id         TEXT    NOT NULL,
    provider        TEXT    NOT NULL,
    transaction_id  TEXT    NOT NULL,
    event_id        TEXT    NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (site_id, provider, transaction_id)
);
CREATE INDEX IF NOT EXISTS idx_payment_events_event ON payment_events(event_id);
