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
#   1. REVKLIK_NEW pointing at the revklik-new checkout (default: sibling dir).
#      Auth is klikapa legacy (session token in localStorage) — no server URL
#      needs to be baked into the bundle anymore.
#
# Preflight gates: typecheck + lint + tests for BOTH repos run before anything
# is built or uploaded — a failing check aborts the deploy (mechanical
# no-bugs guard).
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REVKLIK_NEW="${REVKLIK_NEW:-$(dirname "$ROOT")/revklik-new}"
cd "$ROOT"
echo "==> Gates: klikapa (typecheck, lint, tests)"
bun run typecheck
bun run lint
bun test
echo "==> Gates: revklik-new web (typecheck, tests)"
(cd "$REVKLIK_NEW/apps/web" && bun run check-types && bun run test)


echo "==> Building new UI from $REVKLIK_NEW"
(cd "$REVKLIK_NEW" && bun install --frozen-lockfile \
  && cd apps/web \
  && bunx vite build)

DIST="$REVKLIK_NEW/apps/web/dist"
OUT="$ROOT/apps/app/dist/client"

echo "==> Staging new UI into $OUT (tracker scripts preserved)"
rm -rf "$OUT"
mkdir -p "$OUT"
cp -r "$ROOT/apps/app/public/." "$OUT/"   # klikapa*.js, klikapa-live.js, favicon, etc.
cp -r "$DIST/." "$OUT/"                    # new UI: index.html, assets/, sw.js (overrides index only)

echo "==> Deploying klikapa worker"
cd "$ROOT/apps/app"
# A prior `vite build` leaves .wrangler/deploy/config.json pointing at a frozen
# dist/klikapa artifact — without this cleanup `wrangler deploy` silently
# uploads that stale worker instead of bundling src/worker.
rm -rf .wrangler/deploy dist/klikapa
bunx wrangler deploy

echo "==> Done. Rollback if needed: cd apps/app && bunx wrangler rollback"
