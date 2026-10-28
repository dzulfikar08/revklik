# Contributing to RevKlik

Thanks for helping. RevKlik is licensed under [AGPL-3.0-only](LICENSE); by contributing you agree
that your contribution is released under the same license.

## Before you start

- **Bugs and small fixes**: open a pull request directly, linking the issue if there is one.
- **Features and larger changes**: open an issue first so we can agree on the shape before you
  spend time on it.
- **Security problems**: do not open an issue. Follow [SECURITY.md](SECURITY.md).

## Setup

Requires [Bun](https://bun.sh) 1.4+ (the exact version is the `packageManager` in `package.json`).

```sh
bun install
cp apps/app/.dev.vars.example apps/app/.dev.vars
bun run dev          # Worker + local D1 (http://localhost:5173)
bun run dev:web      # dashboard dev server (set VITE_LEGACY_API_BASE to use the local worker)
```

See the README for the layout of the monorepo. The Worker lives in `apps/app/src/worker`, the
dashboard in `apps/web/src`.

## Checks

Run all of these before pushing; CI runs the same set and a pull request needs them green.

```sh
bun run typecheck                 # worker, shared, sdk, cli, web
bun run lint                      # oxlint
bun test                          # worker suite (bun:test, in-memory SQLite standing in for D1)
(cd apps/web && bun run test)     # dashboard suite (vitest)
bun run fmt                       # oxfmt (tabs, double quotes)
```

## Conventions

- Follow [AGENTS.md](AGENTS.md) (Ultracite rules: explicit types at boundaries, `for...of`,
  no `console.log` in production code, accessible markup).
- Match the surrounding code; reuse existing helpers (`fx`, auth middleware, `plan-gate`) instead
  of adding a second way to do the same thing.
- Schema changes go in `apps/app/src/worker/migrations.ts` as idempotent DDL, with the matching
  types in `packages/shared`.
- Add tests for real behavior: fee and currency math, auth and permission boundaries, plan gating,
  idempotency. Route tests use `createMigratedTestApp` from `apps/app/src/worker/lib/test-harness.ts`.
- **Hosted vs self-hosted**: anything that depends on plans, limits, trials or RevKlik's own
  billing must respect `SELF_HOSTED` (`isSelfHosted(c.env)` in `lib/entitlement.ts`). A new
  deployment-specific value (URL, address, id) belongs in an env var with a documented default,
  never hardcoded.
- No secrets, tokens, customer data or personal addresses in commits, tests or fixtures.

## Pull requests

- Keep them focused: one logical change, a clear description of what and why, and how you tested it.
- Commit messages follow the existing history (`feat(scope): ...`, `fix(scope): ...`,
  `chore(scope): ...`).
- Update the README or docs when behavior or configuration changes.
