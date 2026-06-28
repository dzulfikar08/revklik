-- revklik schema (Postgres port of server/src/migrations.ts).
-- Full union of every column added across the D1 migration history.
-- Types: TEXT ids kept (visitor_id/session_id carry non-uuid prefixes);
-- timestamps -> timestamptz; REAL -> double precision; INTEGER 0/1 -> boolean;
-- JSON TEXT -> jsonb. Hypertable candidate tables use composite PK (site_id, time, id).

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- users ----------
CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL DEFAULT '',
    name          TEXT NOT NULL,
    google_id     TEXT UNIQUE,
    avatar_url    TEXT,
    role          TEXT NOT NULL DEFAULT 'user',
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ---------- api_keys (opaque tokens: kp_/rvt_/rv_) ----------
CREATE TABLE IF NOT EXISTS api_keys (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key_hash      TEXT NOT NULL UNIQUE,
    key_prefix    TEXT NOT NULL,
    name          TEXT NOT NULL DEFAULT 'default',
    token_type    TEXT NOT NULL DEFAULT 'session',
    scopes        jsonb,
    site_id       TEXT,
    last_used_at  timestamptz,
    expires_at    timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_type ON api_keys(user_id, token_type);

-- ---------- events (HYPERTABLE) ----------
CREATE TABLE IF NOT EXISTS events (
    id                TEXT NOT NULL,
    site_id           TEXT NOT NULL,
    session_id        TEXT NOT NULL,
    visitor_id        TEXT NOT NULL,
    timestamp         timestamptz NOT NULL DEFAULT now(),
    event_type        TEXT NOT NULL DEFAULT 'pageview',
    name              TEXT,
    path              TEXT NOT NULL,
    hostname          TEXT,
    referrer          TEXT,
    utm_source        TEXT,
    utm_medium        TEXT,
    utm_campaign      TEXT,
    utm_term          TEXT,
    utm_content       TEXT,
    country           TEXT,
    region            TEXT,
    city              TEXT,
    device_type       TEXT,
    browser           TEXT,
    os                TEXT,
    revenue           double precision,
    props             jsonb,
    fingerprint       TEXT,
    payment_provider  TEXT,
    payment_method    TEXT,
    currency          TEXT DEFAULT 'USD',
    subscription_id   TEXT,
    PRIMARY KEY (site_id, timestamp, id)
);

-- ---------- sessions (HYPERTABLE) ----------
CREATE TABLE IF NOT EXISTS sessions (
    id           TEXT NOT NULL,
    site_id      TEXT NOT NULL,
    visitor_id   TEXT NOT NULL,
    started_at   timestamptz NOT NULL DEFAULT now(),
    ended_at     timestamptz,
    entry_path   TEXT,
    exit_path    TEXT,
    referrer     TEXT,
    utm_source   TEXT,
    utm_medium   TEXT,
    utm_campaign TEXT,
    country      TEXT,
    region       TEXT,
    city         TEXT,
    device_type  TEXT,
    browser      TEXT,
    os           TEXT,
    page_count   INTEGER NOT NULL DEFAULT 1,
    is_bounce    BOOLEAN NOT NULL DEFAULT TRUE,
    fingerprint  TEXT,
    PRIMARY KEY (site_id, started_at, id)
);

-- ---------- visitor_profiles (plain: upserted by site_id+visitor_id) ----------
CREATE TABLE IF NOT EXISTS visitor_profiles (
    id              TEXT PRIMARY KEY,
    site_id         TEXT NOT NULL,
    visitor_id      TEXT NOT NULL,
    name            TEXT,
    email           TEXT,
    phone           TEXT,
    avatar          TEXT,
    first_seen      timestamptz NOT NULL DEFAULT now(),
    last_seen       timestamptz NOT NULL DEFAULT now(),
    country         TEXT,
    region          TEXT,
    city            TEXT,
    device_type     TEXT,
    browser         TEXT,
    os              TEXT,
    total_sessions  INTEGER NOT NULL DEFAULT 0,
    total_pageviews INTEGER NOT NULL DEFAULT 0,
    total_revenue   double precision NOT NULL DEFAULT 0,
    tags            jsonb,
    notes           TEXT,
    fingerprint     TEXT,
    UNIQUE (site_id, visitor_id)
);
CREATE INDEX IF NOT EXISTS idx_vp_site_last_seen ON visitor_profiles(site_id, last_seen);
CREATE INDEX IF NOT EXISTS idx_vp_fingerprint ON visitor_profiles(site_id, fingerprint);

-- ---------- sites ----------
CREATE TABLE IF NOT EXISTS sites (
    id               TEXT PRIMARY KEY,
    user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name             TEXT NOT NULL,
    domain           TEXT NOT NULL,
    share_token      TEXT,
    public_dashboard BOOLEAN NOT NULL DEFAULT FALSE,
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sites_user ON sites(user_id);
CREATE INDEX IF NOT EXISTS idx_sites_share ON sites(share_token);

-- ---------- subscriptions ----------
CREATE TABLE IF NOT EXISTS subscriptions (
    id                       TEXT PRIMARY KEY,
    user_id                  TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    plan                     TEXT NOT NULL DEFAULT 'free',
    status                   TEXT NOT NULL DEFAULT 'active',
    current_period_start     timestamptz NOT NULL DEFAULT now(),
    current_period_end       timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
    cancel_at_period_end     BOOLEAN NOT NULL DEFAULT FALSE,
    polar_subscription_id    TEXT,
    polar_customer_id        TEXT,
    created_at               timestamptz NOT NULL DEFAULT now(),
    updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sub_polar ON subscriptions(polar_subscription_id);

-- ---------- heatmap_clicks (HYPERTABLE) ----------
CREATE TABLE IF NOT EXISTS heatmap_clicks (
    id                TEXT NOT NULL,
    site_id           TEXT NOT NULL,
    session_id        TEXT NOT NULL,
    visitor_id        TEXT NOT NULL,
    path              TEXT NOT NULL,
    x                 double precision NOT NULL,
    y                 double precision NOT NULL,
    element_selector  TEXT,
    element_text      TEXT,
    viewport_width    INTEGER,
    timestamp         timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (site_id, timestamp, id)
);

-- ---------- heatmap_scrolls (HYPERTABLE) ----------
CREATE TABLE IF NOT EXISTS heatmap_scrolls (
    id              TEXT NOT NULL,
    site_id         TEXT NOT NULL,
    session_id      TEXT NOT NULL,
    visitor_id      TEXT NOT NULL,
    path            TEXT NOT NULL,
    max_scroll      double precision NOT NULL,
    viewport_height INTEGER,
    doc_height      INTEGER,
    timestamp       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (site_id, timestamp, id)
);

-- ---------- heatmap_aggregates ----------
CREATE TABLE IF NOT EXISTS heatmap_aggregates (
    id             TEXT PRIMARY KEY,
    site_id        TEXT NOT NULL,
    path           TEXT NOT NULL,
    period         TEXT NOT NULL,
    click_grid     jsonb NOT NULL,
    scroll_depths  jsonb NOT NULL,
    total_sessions INTEGER NOT NULL DEFAULT 0,
    total_clicks   INTEGER NOT NULL DEFAULT 0,
    updated_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (site_id, path, period)
);

-- ---------- session_recordings (HYPERTABLE; events jsonb, atomic append) ----------
CREATE TABLE IF NOT EXISTS session_recordings (
    id             TEXT NOT NULL,
    site_id        TEXT NOT NULL,
    session_id     TEXT NOT NULL,
    visitor_id     TEXT NOT NULL,
    path           TEXT NOT NULL,
    events         jsonb NOT NULL DEFAULT '[]',
    duration       INTEGER NOT NULL DEFAULT 0,
    viewport_width INTEGER,
    viewport_height INTEGER,
    started_at     timestamptz NOT NULL DEFAULT now(),
    ended_at       timestamptz,
    PRIMARY KEY (site_id, started_at, id)
);

-- ---------- integrations ----------
CREATE TABLE IF NOT EXISTS integrations (
    id         TEXT PRIMARY KEY,
    site_id    TEXT NOT NULL,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type       TEXT NOT NULL,
    name       TEXT NOT NULL,
    config     jsonb NOT NULL,
    enabled    BOOLEAN NOT NULL DEFAULT TRUE,
    last_sync  timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_int_site ON integrations(site_id);
CREATE INDEX IF NOT EXISTS idx_int_user ON integrations(user_id);

-- ---------- webhook_events ----------
CREATE TABLE IF NOT EXISTS webhook_events (
    id             TEXT PRIMARY KEY,
    site_id        TEXT NOT NULL,
    integration_id TEXT NOT NULL,
    direction      TEXT NOT NULL,
    event_type     TEXT NOT NULL,
    payload        jsonb NOT NULL,
    status         TEXT NOT NULL DEFAULT 'pending',
    attempts       INTEGER NOT NULL DEFAULT 0,
    created_at     timestamptz NOT NULL DEFAULT now(),
    processed_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_we_site ON webhook_events(site_id, created_at);
CREATE INDEX IF NOT EXISTS idx_we_status ON webhook_events(status, created_at);
CREATE INDEX IF NOT EXISTS idx_we_int ON webhook_events(integration_id);

-- ---------- ai_insights ----------
CREATE TABLE IF NOT EXISTS ai_insights (
    id            TEXT PRIMARY KEY,
    site_id       TEXT NOT NULL,
    range         TEXT NOT NULL,
    insight_type  TEXT NOT NULL,
    insight_text  TEXT NOT NULL,
    data_refs     jsonb,
    confidence    double precision NOT NULL DEFAULT 0.0,
    created_at    timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_site ON ai_insights(site_id, range, insight_type);
CREATE INDEX IF NOT EXISTS idx_ai_expires ON ai_insights(expires_at);

-- ---------- team_members ----------
CREATE TABLE IF NOT EXISTS team_members (
    id          TEXT PRIMARY KEY,
    site_id     TEXT NOT NULL,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        TEXT NOT NULL DEFAULT 'viewer',
    invited_by  TEXT NOT NULL REFERENCES users(id),
    invited_at  timestamptz NOT NULL DEFAULT now(),
    accepted_at timestamptz,
    UNIQUE (site_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_tm_user ON team_members(user_id);

-- ---------- push_tokens ----------
CREATE TABLE IF NOT EXISTS push_tokens (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_token TEXT NOT NULL UNIQUE,
    platform     TEXT NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pt_user ON push_tokens(user_id);

-- ---------- payment_providers ----------
CREATE TABLE IF NOT EXISTS payment_providers (
    id         TEXT PRIMARY KEY,
    site_id    TEXT NOT NULL,
    provider   TEXT NOT NULL,
    config     jsonb NOT NULL,
    enabled    BOOLEAN DEFAULT TRUE,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pp_site ON payment_providers(site_id);
CREATE INDEX IF NOT EXISTS idx_pp_site_provider ON payment_providers(site_id, provider);

-- ---------- webhook_logs ----------
CREATE TABLE IF NOT EXISTS webhook_logs (
    id           TEXT PRIMARY KEY,
    site_id      TEXT NOT NULL,
    provider     TEXT NOT NULL,
    event_type   TEXT NOT NULL,
    payload      jsonb NOT NULL,
    status       TEXT DEFAULT 'pending',
    error        TEXT,
    created_at   timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_wl_site ON webhook_logs(site_id);
CREATE INDEX IF NOT EXISTS idx_wl_site_provider ON webhook_logs(site_id, provider);

-- ---------- segments ----------
CREATE TABLE IF NOT EXISTS segments (
    id         TEXT PRIMARY KEY,
    site_id    TEXT NOT NULL,
    name       TEXT NOT NULL,
    filters    jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_segments_site ON segments(site_id);

-- ---------- annotations ----------
CREATE TABLE IF NOT EXISTS annotations (
    id         TEXT PRIMARY KEY,
    site_id    TEXT NOT NULL,
    date       DATE NOT NULL,
    text       TEXT NOT NULL,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_annotations_site ON annotations(site_id, date);

-- ---------- email_reports ----------
CREATE TABLE IF NOT EXISTS email_reports (
    id         TEXT PRIMARY KEY,
    site_id    TEXT NOT NULL,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    frequency  TEXT NOT NULL DEFAULT 'weekly',
    enabled    BOOLEAN DEFAULT TRUE,
    last_sent  timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_er_site ON email_reports(site_id);

-- ---------- search_console_data ----------
CREATE TABLE IF NOT EXISTS search_console_data (
    id          TEXT PRIMARY KEY,
    site_id     TEXT NOT NULL,
    date        DATE NOT NULL,
    query       TEXT NOT NULL,
    clicks      INTEGER DEFAULT 0,
    impressions INTEGER DEFAULT 0,
    ctr         double precision DEFAULT 0,
    position    double precision DEFAULT 0,
    fetched_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scd_site_date ON search_console_data(site_id, date);

-- ---------- marketplace_orders ----------
CREATE TABLE IF NOT EXISTS marketplace_orders (
    id         TEXT PRIMARY KEY,
    site_id    TEXT NOT NULL,
    marketplace TEXT NOT NULL,
    order_id   TEXT NOT NULL,
    order_sn   TEXT NOT NULL,
    amount     double precision DEFAULT 0,
    currency   TEXT DEFAULT 'IDR',
    status     TEXT DEFAULT 'pending',
    buyer_info jsonb,
    items      jsonb,
    ordered_at timestamptz NOT NULL,
    synced_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (site_id, marketplace, order_sn)
);
CREATE INDEX IF NOT EXISTS idx_mo_site ON marketplace_orders(site_id, marketplace, ordered_at);

-- ---------- affiliates ----------
CREATE TABLE IF NOT EXISTS affiliates (
    id               TEXT PRIMARY KEY,
    user_id          TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    referral_code    TEXT NOT NULL UNIQUE,
    commission_rate  double precision DEFAULT 0.2,
    total_earned     double precision DEFAULT 0,
    total_paid       double precision DEFAULT 0,
    status           TEXT DEFAULT 'active',
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_aff_code ON affiliates(referral_code);

-- ---------- referrals ----------
CREATE TABLE IF NOT EXISTS referrals (
    id                TEXT PRIMARY KEY,
    affiliate_id      TEXT NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
    referred_user_id  TEXT NOT NULL,
    event             TEXT NOT NULL DEFAULT 'signup',
    commission_amount double precision DEFAULT 0,
    status            TEXT DEFAULT 'pending',
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ref_affiliate ON referrals(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_ref_user ON referrals(referred_user_id);
