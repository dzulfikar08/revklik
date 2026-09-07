# Cutover runbook — replacing the old SPA with the new UI (RW-12)

One command once prerequisites are met: `./scripts/deploy-new-ui.sh`.

## Preconditions (all must hold)

1. **Auth server deployed** (revklik-new, `packages/infra`: `bun run deploy` there):
   - env: `BETTER_AUTH_SECRET` (strong), `CORS_ORIGIN=https://app.revklik.com`,
     `POLAR_ACCESS_TOKEN`/`POLAR_ORG_ID` (real, or billing checkout stays broken —
     see "Known prod gaps" below), `POLAR_SUCCESS_URL=https://app.revklik.com/success`.
   - `klikapaDb` binding adopts the **real** `klikapa-db` → the alchemy stack must run
     in the **same Cloudflare account** as klikapa.
   - Note the deployed URL (e.g. `https://revklik-new-server.<account>.workers.dev`) —
     this is `VITE_SERVER_URL`. A custom route/domain is nicer but not required
     (XHR + cookies to it are cross-origin; CORS_ORIGIN covers it).
2. **Worker API fixes live** (branch `rw/worker-fixes`, deploy from that branch or
   merge first): campaigns endpoint, `prev_timeseries`, session-only authMiddleware,
   `/auth/logout`, `/auth/me`, billing error hardening.
3. **Smoke Option B end-to-end against prod**: sign in at the deployed server origin
   (or any revklik-new deployment pointed at it) with an email that exists in klikapa,
   confirm `api_keys` gains a `revklik-new` session row and `/analytics` renders data.
4. **Version pin**: `cd apps/app && bunx wrangler deployments list` — record the last
   old-SPA version id for instant rollback.

## What the swap changes

| Route                                                                 | Before            | After                                                                                                                                                        |
| --------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/`, `/login`, `/register`, `/paywall`, `/integrations`, `/settings*` | old SPA pages     | new UI routes (`/` is the new app root — **redirect `/` → `/analytics` pre-cutover**, see below); old routes not in the new UI fall through to the SPA shell |
| `/analytics`                                                          | old SPA dashboard | new UI dashboard (full parity per matrix)                                                                                                                    |
| `/api/*`                                                              | klikapa worker    | unchanged (`run_worker_first`)                                                                                                                               |
| `/klikapa*.js`, `/klikapa-live.js`                                    | static assets     | unchanged (copied from `apps/app/public`)                                                                                                                    |
| `/api/public/:token`, `/api/widgets/live/:token`, `/api/widget-data`  | worker JSON       | unchanged                                                                                                                                                    |

**Required pre-cutover tweak (revklik-new):** make the new root route redirect to
`/analytics` (old users land on `https://app.revklik.com/` bookmarks). One-line
`beforeLoad` redirect in `apps/web/src/routes/index.tsx`.

## Mobile apps (frozen)

Capacitor shells wrap the OLD bundle and Bearer `kp_` against prod `/api` — unaffected
by this swap. Keep them frozen until the mobile decision (matrix "Decide-then-port").

## Rollback

```bash
cd apps/app && bunx wrangler rollback            # instant, to pinned version
# or: git -C . checkout <prev-commit> && bun run deploy   # rebuild old SPA
```

## Post-cutover monitoring (first 48h)

- Worker error rate (D1 errors) — Cloudflare dashboard, worker `klikapa`.
- SSE connection counts on `/api/analytics/stream`.
- Tracker ingest: `POST /api/track` volume flat vs prior week.
- Auth: failed mints (no klikapa account) are expected noise during transition;
  sustained 429s mean token churn — investigate.
- Delete dead old-client code (`revklik/apps/app/src/client`) only after a full
  release cycle.

## Known prod gaps (pre-existing, not blockers)

- `POST /billing/checkout` (Polar) 500s for all accounts: `POLAR_*_PRODUCT_ID` unset →
  products `[]` → Polar 422 (deterministic throw at `routes/billing.ts:221`). Fix =
  set the three product-id secrets + valid `POLAR_ACCESS_TOKEN`. QRIS path unaffected.
- Worker `VALID_TYPES` predates marketplace integration types (`shopee`/`tokopedia`
  rejected by `POST /integrations` — they attach via OAuth callback only).
