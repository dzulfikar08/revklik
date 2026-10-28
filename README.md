# RevKlik

Privacy-first web analytics that connects visitors to revenue. One Cloudflare Worker, one D1
database, a tracking script of about 4 KB, and a dashboard in English and Bahasa Indonesia.

> **License:** [AGPL-3.0-only](LICENSE). You can run, modify and self-host RevKlik freely. If you
> offer a modified version to others over a network, you must publish your changes under the same
> license. Third-party notices: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
> The hosted service at [app.revklik.com](https://app.revklik.com) runs this same code with paid
> plans; a self-hosted install is fully unlocked (see [Self-host](#self-host-on-cloudflare)).

## What it does

- **Web analytics**: visitors, pageviews, sessions, bounce rate, visit duration, sources, UTM
  campaigns, pages, geography, devices, with previous-period comparison. Cookieless; visitors are
  shown under pseudonyms. Bot and datacenter traffic is flagged and filtered.
- **Revenue analytics**: conversions carry revenue. Payment providers feed the same panels:
  Stripe, LemonSqueezy, Polar, Midtrans, Xendit, DOKU, Mayar, Paywuz, plus Shopee and Tokopedia,
  App Store Connect, and a server-side events API for anything else.
- **Funnels and journeys**: scroll funnels derived from page sections, per-visitor journey
  timelines, segments, annotations.
- **Heatmaps and session replays**, **AI insights** (Cloudflare Workers AI), revenue predictions.
- **Search Console** queries next to your traffic (Google OAuth or a service account key).
- **Realtime** visitor count and event feed, public dashboards, embeddable live widget.
- **Public API and MCP server** (`rvt_` account tokens, `rv_` site tokens with scopes), a
  TypeScript SDK and a CLI.
- **Team access**, email reports, CSV export, daily database backup to R2.

## Repository layout

| Path                            | What                                                                        |
| ------------------------------- | --------------------------------------------------------------------------- |
| `apps/app`                      | The Worker (Hono + Kysely over D1), tracker scripts, Capacitor shell        |
| `apps/web`                      | Dashboard SPA (TanStack Router/Query, Tailwind v4), served as Worker assets |
| `apps/fumadocs`, `apps/landing` | Docs site and marketing site (Astro)                                        |
| `apps/native`                   | Native app shell                                                            |
| `packages/shared`               | D1 and API types                                                            |
| `packages/sdk`, `packages/cli`  | `@revklik/sdk` and `@revklik/cli`                                           |
| `packages/{config,env,ui}`      | Shared tsconfig, typed env loader, UI kit                                   |

The worker is named `klikapa` in the hosted deployment for historical reasons (secrets, crons and
the D1 database are attached to that name). Self-hosted installs pick their own name.

## Quick start (local)

Requires [Bun](https://bun.sh) 1.4+.

```sh
bun install
cp apps/app/.dev.vars.example apps/app/.dev.vars   # SELF_HOSTED=1 is on by default there
bun run dev                                        # Worker + local D1 on http://localhost:5173
```

Tables are created automatically on the first request (idempotent DDL in
`apps/app/src/worker/migrations.ts`), so there is no separate migration step.

The dashboard dev server defaults to the hosted API. To develop against your local worker:

```sh
echo 'VITE_LEGACY_API_BASE=http://localhost:5173/api' > apps/web/.env.local
bun run dev:web
```

Checks, all of which CI runs:

```sh
bun run typecheck      # worker, shared, sdk, cli, web (vite build + tsc)
bun run lint           # oxlint
bun test               # worker suite
(cd apps/web && bun run test)   # dashboard suite
```

## Self-host on Cloudflare

A self-hosted RevKlik runs with `SELF_HOSTED=1`: every account has every feature, there are no
plan limits, trials, checkout pages or referral program, and nothing talks to RevKlik's billing.
You need a Cloudflare account (the free plan works for small sites; D1, Workers AI and R2 have
free allowances) and Bun.

1. **Clone and install**

   ```sh
   git clone https://github.com/dzulfikar08/revklik.git && cd revklik
   bun install
   bunx wrangler login
   ```

2. **Create the D1 database**

   ```sh
   bunx wrangler d1 create revklik-db
   ```

   Copy the printed `database_id`.

3. **Create your wrangler config.** The committed `apps/app/wrangler.jsonc` is the hosted
   deployment's; do not deploy it. Start from the template instead:

   ```sh
   cp apps/app/wrangler.example.jsonc apps/app/wrangler.selfhost.jsonc   # gitignored
   ```

   Edit `wrangler.selfhost.jsonc`: set `database_id`, and in `vars` set `APP_URL` (the public
   origin, no trailing slash) and `SUPER_ADMIN_EMAIL`. Optionally uncomment the R2 backup bucket
   (`bunx wrangler r2 bucket create revklik-backups`), the `send_email` binding and `EMAIL_FROM`,
   and a custom domain route.

4. **Set secrets** (all optional; only what you use). Run each from `apps/app` with
   `--config wrangler.selfhost.jsonc`:

   ```sh
   cd apps/app
   bunx wrangler secret put GOOGLE_CLIENT_SECRET --config wrangler.selfhost.jsonc
   ```

   | Name                                                                | Purpose                                                                                                       |
   | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
   | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`                          | "Continue with Google" sign-in and Search Console connect. Redirect URI: `<APP_URL>/api/auth/google/callback` |
   | `SHOPEE_PARTNER_ID`, `SHOPEE_SHOP_ID`                               | Shopee marketplace sync                                                                                       |
   | `TOKOPEDIA_CLIENT_ID`, `TOKOPEDIA_CLIENT_SECRET`, `TOKOPEDIA_FS_ID` | Tokopedia marketplace sync                                                                                    |

   Plain `vars` (in the wrangler config, not secrets): `SELF_HOSTED`, `APP_URL`,
   `SUPER_ADMIN_EMAIL`, `EMAIL_FROM`, `FX_USD_IDR`, `RETENTION_HARD_DELETE_DAYS`. Every variable
   is documented in [`apps/app/.dev.vars.example`](apps/app/.dev.vars.example). The `POLAR_*` and
   `PAKASIR_*` variables belong to the hosted product's own billing and are ignored when
   `SELF_HOSTED=1`. Payment-provider credentials for _your_ sites (Stripe, Midtrans, ...) are
   entered per site in the dashboard, not as Worker secrets.

5. **Deploy**

   ```sh
   WRANGLER_CONFIG=wrangler.selfhost.jsonc ./scripts/deploy-new-ui.sh
   ```

   The script runs the checks, builds the dashboard, stages it next to the tracker scripts and
   runs `wrangler deploy`. Roll back with `cd apps/app && bunx wrangler rollback --config wrangler.selfhost.jsonc`.

6. **First user.** Open `APP_URL/register` and sign up with the email you set as
   `SUPER_ADMIN_EMAIL`: that account becomes `super_admin` (admin panel, user management). The
   database tables are created on that first request.

7. **Track a site.** Add a site in the dashboard and paste its snippet into your pages:

   ```html
   <script defer data-site-id="SITE_ID" src="https://YOUR-APP-URL/klikapa.js"></script>
   ```

Things to know:

- Registration is open. If the instance should not be public, put it behind
  [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) or restrict
  the route, then invite people by creating their accounts yourself.
- Without the `EMAIL` binding no email is sent: verification links, password resets, team
  invitations and reports are skipped, so the "verify your email" reminder stays visible.
- Cron triggers (nightly backup, App Store Connect sync, hourly bot reclassification) are in the
  template's `triggers.crons`.

## Contributing, security, conduct

- [CONTRIBUTING.md](CONTRIBUTING.md): setup, conventions, what a good pull request looks like.
- [SECURITY.md](SECURITY.md): how to report a vulnerability (please do not open a public issue).
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)

## Deployment notes (hosted)

- `bun run deploy` runs typecheck, lint and tests, then `scripts/deploy-new-ui.sh` (build `apps/web`,
  stage into `apps/app/dist/client`, `wrangler deploy`). Pushes to `main` of the upstream repository
  deploy automatically through `.github/workflows/deploy-hosted.yml` (needs the
  `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets); forks never deploy.
- `run_worker_first: ["/api/*"]`: tracker scripts (`/klikapa-*.js`) are served straight from the
  assets runtime without waking the Worker.
- Do not rename the hosted Worker `klikapa`: secrets, crons, the D1 database and the workers.dev
  URL are attached to it.
- Mobile: `apps/app/.env.mobile` (gitignored) overrides `VITE_API_BASE`.

## License

Copyright (C) RevKlik contributors. Licensed under the
[GNU Affero General Public License v3.0 only](LICENSE).
