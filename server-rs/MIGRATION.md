# revklik-server migration & deploy guide

Rust/Axum + Postgres/TimescaleDB port of the Cloudflare Workers backend.

## Architecture

- **`server-rs/`** — Rust crate (axum + tokio + sqlx). Single binary.
- **Postgres + TimescaleDB** — `events`, `sessions`, `heatmap_clicks`, `heatmap_scrolls`,
  `session_recordings` are **hypertables** (composite PK `(site_id, time, id)`).
  `events_hourly` + `sessions_daily` continuous aggregates use **HyperLogLog**
  (`hyperloglog(12, visitor_id)` / `rollup()` / `distinct_count()`) for approximate visitor
  counts (~1% drift); pageviews + revenue stay exact.
- **`docker-compose.yml`** — `timescale/timescaledb-ha:pg16` + `api` + Caddy (auto-HTTPS).
- Client (React/Vite web + Capacitor) is unchanged; repoint its API base URL (Phase 13).

## Phase 12 — migrate existing D1 data

The target DB must have **only `0001_init.sql`** applied (plain tables) before loading. Do NOT
run `0002`–`0005` (hypertables/caggs) until after the bulk load — `COPY`/`INSERT` into plain
tables is faster, and `create_hypertable(migrate_data=>true)` re-chunks afterward.

```bash
# 0. target DB exists (compose db up); apply ONLY 0001.
docker compose up -d db
psql "$DATABASE_URL" -f server-rs/migrations/0001_init.sql

# 1. export D1 production dump (needs wrangler auth on the original account).
npx wrangler d1 export klikapa-db --remote --output dump.sql

# 2. transform D1 SQL -> Postgres INSERTs (normalizes timestamps, booleans, validates JSON).
node server-rs/scripts/migrate_d1_to_pg/transform.js < dump.sql > load.sql
# inspect load.sql; watch stderr for invalid-JSON warnings.

# 3. bulk load.
psql "$DATABASE_URL" -f load.sql

# 4. NOW create hypertables, indexes, caggs, retention, GIN, idempotency table.
psql "$DATABASE_URL" -f server-rs/migrations/0002_hypertables.sql
psql "$DATABASE_URL" -f server-rs/migrations/0003_indexes.sql
psql "$DATABASE_URL" -f server-rs/migrations/0004_caggs.sql      # creates timescaledb_toolkit + caggs
psql "$DATABASE_URL" -f server-rs/migrations/0005_gin_jsonb.sql

# 5. backfill caggs over migrated data (refresh_continuous_aggregate can't run in a tx).
psql "$DATABASE_URL" -c "CALL refresh_continuous_aggregate('events_hourly', NULL, NULL);"
psql "$DATABASE_URL" -c "CALL refresh_continuous_aggregate('sessions_daily', NULL, NULL);"

# 6. validate row counts vs D1.
psql "$DATABASE_URL" -c "SELECT 'events' t, count(*) FROM events UNION ALL SELECT 'sessions', count(*) FROM sessions UNION ALL SELECT 'visitor_profiles', count(*) FROM visitor_profiles;"
```

Gotchas baked into `transform.js` + migrations:
- **Composite PK required** — single-column PKs rejected by Timescale; `events` etc. use `(site_id, time, id)`.
- `AVG(is_bounce)` → `AVG((is_bounce)::int)` (boolean has no AVG).
- `source` is a **STORED generated column** — never drop it (the cagg depends on it).
- `session_recordings.events` is `jsonb`; the broken TS `substr(...)||chunk||']` append is replaced by atomic `events || $1::jsonb`.
- Payment/webhook dedup uses the `payment_events` idempotency table + GIN `@>` instead of `props LIKE`.
- All timestamps normalized to UTC `Z`; `postgresql.conf` `timezone=UTC`.

## Phase 13 — deploy to VPS

### Local dev (orbstack/docker)
```bash
cd revklik-app
cp server-rs/.env.example server-rs/.env       # fill secrets
docker compose up -d db                          # DB on 127.0.0.1:15432 (avoids host pg:5432)
# run the API directly during dev:
cd server-rs
REV_DATABASE_URL=postgres://revklik:revklik@localhost:15432/revklik \
  REV_HOST=0.0.0.0 REV_PORT=8787 REV_CORS_ORIGINS=* cargo run
curl localhost:8787/healthz   # {"status":"ok"}
```

### Production (VPS)
```bash
# on the VPS:
git clone <repo> revklik && cd revklik/revklik-app
cp server-rs/.env.example server-rs/.env        # set all REV_* secrets, POSTGRES_PASSWORD
echo "DOMAIN=api.yourdomain.com" > .env-compose
# GeoLite2 DB (optional, for geo): drop GeoLite2-City.mmdb into the geoip_data volume.
docker compose --env-file .env-compose up -d --build
```

- Caddy auto-provisions HTTPS for `$DOMAIN`.
- `/api/track*`, `/api/billing/webhook`, `/api/webhooks/*` are public (no auth).
- API runs migrations + refreshes caggs on boot.
- Health: `curl https://$DOMAIN/healthz`.

### Required secrets (`.env`)
```
POSTGRES_PASSWORD=<strong>
REV_DATABASE_URL=postgres://revklik:<pw>@db:5432/revklik
REV_CORS_ORIGINS=https://app.yourdomain.com
REV_GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI
REV_POLAR_ACCESS_TOKEN/ORG_ID/WEBHOOK_SECRET
REV_LLM_BASE_URL/API_KEY/MODEL
REV_CF_EMAIL_API_BASE/API_TOKEN/ACCOUNT_ID, REV_EMAIL_FROM
REV_SHOPEE_* / REV_TOKOPEDIA_*   (marketplaces — see Phase 8)
REV_PAKASIR_API_KEY
REV_GEOIP_DB_PATH=/data/GeoLite2-City.mmdb
```

### Email (Cloudflare)
`noreply@revklik.com` must be onboarded to Cloudflare Email Sending:
`npx wrangler email sending enable revklik.com`, plus SPF/DKIM/DMARC records. The API calls the
REST endpoint `POST /accounts/{id}/email/sending/send` (not the Workers binding).

### Client repoint
In `client/` + Capacitor config, point the API base URL at `https://api.yourdomain.com` (was the
Workers origin). No request/response shape changes — the Rust API mirrors the TS API exactly.

## Remaining (Phase 8 — not yet ported)
Marketplace OAuth + order sync (Shopee HMAC, Tokopedia basic-auth) and Google Search Console
import (`routes/marketplace_*.ts`, `routes/gsc.ts`) are the one area not yet implemented — they
are self-contained OAuth flows that can be ported independently. All other route groups are built.
