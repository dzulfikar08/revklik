# RevKlik

Privacy-first web analytics (visitor -> revenue) — monorepo for the whole
product: klikapa analytics worker, new web UI, auth/billing server, docs, and
shared packages. Deployed Cloudflare worker name stays `klikapa` (do not
rename; secrets, crons, D1 `klikapa-db`, and the workers.dev URL are attached).

## Layout

Merged from `dzulfikar08/klikapa` + `dzulfikar08/revklik-new` (2026-09-12,
subtree merge — history preserved).

- **apps/app** `@revklik/app` — klikapa analytics worker: Hono API (`/api/*`),
  kysely over D1, tracker scripts in `public/`, Capacitor shell. One Vite
  build for the worker; UI assets come from `apps/web` (see deploy below).
- **apps/web** `web` — the new analytics dashboard (TanStack Router + Query,
  Tailwind v4). Built by `scripts/deploy-new-ui.sh` and staged as klikapa
  worker assets.
- **apps/server** — better-auth server (OAuth, sessions, billing glue),
  deployed by `packages/infra` via alchemy.
- **apps/native** — Capacitor app shell.
- **apps/fumadocs** — docs site (Astro/fumadocs).
- **packages/shared** `@revklik/shared` — klikapa D1/API types (source-only).
- **packages/sdk** `@revklik/sdk`, **packages/cli** `@revklik/cli`.
- **packages/{api,auth,config,db,env,ui}** — auth-server support packages.
- **packages/infra** `@revklik/infra` — alchemy stack deploying the auth
  server + klikapa-db binding (`bun run deploy:infra`).

## Commands

```sh
bun install          # from repo root

# klikapa analytics worker
bun run dev          # vite dev (5173) + worker + local D1
bun run deploy       # GATED: typecheck + lint + tests, then build web + wrangler deploy
bun run typecheck    # worker + shared + sdk + cli
bun run lint         # oxlint
bun run test         # worker test suite (bun test)
bun run fmt          # oxfmt

# dashboard / server (turbo)
bun run dev:web      # apps/web dev server
bun run dev:server   # auth server dev
bun run dev:docs     # docs site dev
bun run typecheck:apps   # turbo check-types across apps
bun run deploy:infra # alchemy deploy of auth server (packages/infra)
bun run db:generate  # drizzle migrations for auth db
```

Note: the alchemy app name derives from the repo directory — deploys of
`packages/infra` from this repo use app id `revklik` (the old `revklik-new`
dev stack in state is orphaned and can be ignored).

## Deploy

- Production deploy: `bun run deploy` (root) — runs gates, then
  `scripts/deploy-new-ui.sh`: builds `apps/web`, stages it into
  `apps/app/dist/client` next to the tracker scripts, `wrangler deploy`.
- Auth server: `bun run deploy:infra` (alchemy; env in `packages/infra/.env`).
- Rollback: `cd apps/app && bunx wrangler rollback`.

## Notes

- `run_worker_first: ["/api/*"]` in wrangler.jsonc — tracker scripts
  (`/klikapa-*.js`) are served straight from the assets runtime.
- Migrations: `apps/app/src/worker/migrations.ts` (idempotent DDL per isolate).
  Verify before changing.
- Mobile: `apps/app/.env.mobile` (gitignored) overrides `VITE_API_BASE`.
