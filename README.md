# RevKlik

Privacy-first web analytics (visitor → revenue), deployed as a single Cloudflare Worker.

## Stack

- **Bun workspaces** — `apps/*` + `packages/*`, no turbo
- **apps/app** — one Vite build = React SPA + Hono worker via `@cloudflare/vite-plugin`
  - `src/client` — TanStack Router (file-based) + TanStack Query, Tailwind v4, Capacitor 8
  - `src/worker` — Hono API (`/api/*`), kysely over D1 (SQLite dialect shim)
- **packages/shared** — `@revklik/shared`, source-only types (no build step)
- **packages/sdk** `@revklik/sdk` · **packages/cli** `@revklik/cli`
- oxlint + oxfmt

## Commands

```sh
bun install          # from repo root
bun run dev          # vite dev server (5173) with worker + local D1 bindings
bun run build        # vite build → dist/client + dist/klikapa
bun run preview      # vite preview against built output
bun run deploy       # clean build + wrangler deploy
bun run typecheck    # worker + client + shared + sdk + cli
bun run lint         # oxlint
bun run fmt          # oxfmt
bun run build:sdk    # tsup build @revklik/sdk
bun run build:cli    # tsup build @revklik/cli
bun run mobile:prepare   # mobile web build + cap sync
```

## Notes

- Deployed worker name is `klikapa` (wrangler.jsonc) — do not rename; secrets,
  crons, D1 (`klikapa-db`), and the workers.dev URL are attached to it.
- `run_worker_first: ["/api/*"]` — tracker scripts (`/klikapa-*.js`) are served
  straight from the assets runtime, never through the worker.
- Migrations: `apps/app/src/worker/migrations.ts` — idempotent DDL run per
  isolate on first request (kysely-migrate is future work).
- Local dev uses local D1 via miniflare (`cloudflare({ remoteBindings: false })`
  in vite.config.ts). Flip to `true` for remote bindings (needs `account_id`).
- Mobile: `apps/app/.env.mobile` (gitignored) overrides `VITE_API_BASE`.
