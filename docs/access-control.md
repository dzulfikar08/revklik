# Access control and rate limits

## Site roles

Every site route resolves the caller's role once, in `lib/site-access.ts`:

```ts
const access = await requireSiteAccess(c, siteId, "write");
if (access instanceof Response) return access; // 404 stranger, 403 wrong role
```

The table lives in `lib/site-roles.ts` (`ROLE_TABLE`):

| Role | read | write | manage | owner |
|---|---|---|---|---|
| owner | yes | yes | yes | yes |
| admin | yes | yes | yes | no |
| editor | yes | yes | no | no |
| viewer | yes | no | no | no |

- **write**: annotations, segments, email reports, visitor notes, syncs, payment providers, Polar config.
- **manage**: GSC service account and GSC connect, imports.
- **owner**: integrations, sharing, widget, exclusions, purge, delete site, team, site-token roles for events.

An invitation that is not accepted grants nothing. `GET /api/sites/:siteId/access` returns the caller's role and
what it can do, for clients that hide controls.

`routes/access-matrix.test.ts` lists every mutating route, calls each as stranger / pending invite / viewer /
editor / admin / owner, and fails on any mutating route that is not classified. Add new routes to it.

## Tokens

`lib/token-service.ts` backs both `/api/tokens` (dashboard session) and `/api/v1/tokens` (API token).
A token minted through the API can never hold `tokens:write`, can never hold a scope its minting token lacks, and a
site token cannot mint at all. A site token with `events:write` needs a write role on the site, and an account token's `events:write` is checked the same way on every sale it books (`POST /api/v1/events/server`), so a viewer's token never writes.

Revenue can only be posted by a server holding such a token (`POST /api/v1/events/server`, or
`POST /api/track/payment` with `Authorization: Bearer rv_…`). `POST /api/identify` only accepts a visitor the site
has already recorded.

## Rate limiting

`apps/app/wrangler.jsonc` declares Workers Rate Limiting bindings (`RL_TRACK` 120/min, `RL_TRACK_HEAVY` 30/min,
`RL_API_30|120|300|6000`). `lib/rate-limit.ts` uses them when present and falls back to a per-isolate in-memory
window otherwise (dev, tests, self-hosted installs without the bindings). API limits are keyed per token id.
The `limit` values in wrangler.jsonc must match the caps in `lib/rate-limit.ts` and `routes/track.ts`.
Namespace ids (7101-7106) must be unique within the Cloudflare account.

## Unfinished integrations

Shopee and Tokopedia answer 404 unless `MARKETPLACES_ENABLED=1`. Do not enable it before the placeholder partner
key and the unbound OAuth `state` are fixed. GSC OAuth uses HMAC-signed state (user, site, 10 minute expiry)
issued by `POST /api/gsc/auth-url`.
