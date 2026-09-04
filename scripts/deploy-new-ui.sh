#!/usr/bin/env bash
# Build the revklik-new UI and stage it as klikapa worker assets (RW-12 cutover).
#
# Replaces the old TanStack SPA with the new /analytics UI on app.revklik.com
# while KEEPING everything the worker must still serve:
#   - tracker scripts (klikapa*.js) from apps/app/public
#   - /api/* (run_worker_first) — unchanged worker code
#   - public routes: /api/public/:token, /api/widgets/live/:token, /api/widget-data
#
# Rollback: `bunx wrangler rollback` in apps/app (or redeploy the previous
# revklik commit) — the old SPA stays buildable in-repo.
#
# Prerequisites (see docs/cutover.md):
#   1. revklik-new server worker DEPLOYED with prod env
#      (BETTER_AUTH_SECRET, CORS_ORIGIN=https://app.revklik.com, POLAR_*)
#      and its klikapaDb D1 binding adopting the real klikapa-db (same CF account).
#   2. REVKLIK_NEW pointing at the revklik-new checkout (default: sibling dir).
#   3. VITE_SERVER_URL exported — the deployed better-auth/oRPC server URL.
#      Refuses to run without it: without auth the new UI cannot log anyone in.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REVKLIK_NEW="${REVKLIK_NEW:-$(dirname "$ROOT")/revklik-new}"
: "${VITE_SERVER_URL:?VITE_SERVER_URL must point at the deployed revklik-new server (e.g. https://revklik-new-server.<account>.workers.dev)}"

echo "==> Building new UI from $REVKLIK_NEW (VITE_SERVER_URL=$VITE_SERVER_URL)"
(cd "$REVKLIK_NEW" && bun install --frozen-lockfile \
  && cd apps/web \
  && VITE_SERVER_URL="$VITE_SERVER_URL" bunx vite build)

DIST="$REVKLIK_NEW/apps/web/dist"
OUT="$ROOT/apps/app/dist/client"

echo "==> Staging new UI into $OUT (tracker scripts preserved)"
rm -rf "$OUT"
mkdir -p "$OUT"
cp -r "$ROOT/apps/app/public/." "$OUT/"   # klikapa*.js, klikapa-live.js, favicon, etc.
cp -r "$DIST/." "$OUT/"                    # new UI: index.html, assets/, sw.js (overrides index only)

echo "==> Deploying klikapa worker"
cd "$ROOT/apps/app"
bunx wrangler deploy

echo "==> Done. Rollback if needed: cd apps/app && bunx wrangler rollback"
