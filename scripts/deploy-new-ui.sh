#!/usr/bin/env bash
# Build the dashboard UI (apps/web) and stage it as klikapa worker assets.
#
# Everything the worker must still serve is preserved:
#   - tracker scripts (klikapa*.js) from apps/app/public
#   - /api/* (run_worker_first) — worker code
#
# Rollback: `bunx wrangler rollback` in apps/app.
#
# Preflight gates: typecheck + lint + tests for worker and web UI run before
# anything is built or uploaded — a failing check aborts the deploy.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> Gates: klikapa worker (typecheck, lint, tests)"
bun run typecheck
bun run lint
bun test

echo "==> Gates: web UI (typecheck, tests)"
(cd "$ROOT/apps/web" && bun run check-types && bun run test)

echo "==> Building web UI"
(cd "$ROOT/apps/web" && bunx vite build)

DIST="$ROOT/apps/web/dist"
OUT="$ROOT/apps/app/dist/client"

echo "==> Staging web UI into $OUT (tracker scripts preserved)"
rm -rf "$OUT"
mkdir -p "$OUT"
cp -r "$ROOT/apps/app/public/." "$OUT/"   # klikapa*.js, klikapa-live.js, favicon, etc.
cp -r "$DIST/." "$OUT/"                    # web UI: index.html, assets/, sw.js (overrides index only)

echo "==> Deploying klikapa worker"
cd "$ROOT/apps/app"
# A prior `vite build` leaves .wrangler/deploy/config.json pointing at a frozen
# dist/klikapa artifact — without this cleanup `wrangler deploy` silently
# uploads that stale worker instead of bundling src/worker.
rm -rf .wrangler/deploy dist/klikapa
bunx wrangler deploy

echo "==> Done. Rollback if needed: cd apps/app && bunx wrangler rollback"
