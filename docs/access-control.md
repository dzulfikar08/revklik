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

## Sign-in to RevKlik Books

RevKlik is the OAuth 2.0 provider (authorization code + PKCE S256) for one first-party client, `revklik-books`
(`lib/oauth-provider.ts`, `routes/oauth.ts`). It is identity only: no access or refresh token is ever issued.

- `GET /oauth/authorize`: an unknown client or a `redirect_uri` that is not an exact match of
  `BOOKS_OAUTH_REDIRECT_URIS` gets an error page and is never redirected to. Other request problems (missing
  `state`, `response_type` other than `code`, no S256 challenge) go back to the validated `redirect_uri` as an
  RFC 6749 error. A valid request gets a small page whose script reads the dashboard token from `localStorage`,
  calls `POST /api/oauth/authorize` (Bearer session, re-validates everything) and follows the returned redirect.
  With no session it goes to `/login?next=/oauth/authorize?…`, the only `next` besides `/analytics` the login
  accepts (`parseNext`), including after "Continue with Google". No consent screen: the client is first-party.
- Codes are 32 random bytes, stored as SHA-256 in `oauth_codes`, valid 60 s, bound to client, redirect URI,
  challenge and user. Redemption is one `DELETE ... RETURNING`: a replay, a race and a failed redirect/PKCE check all
  leave the code dead. A wrong client secret answers `invalid_client` before the code is touched.
- `POST /oauth/token` (form-encoded) answers `{sub, email, email_verified, name}` with `Cache-Control: no-store`,
  or 400 `invalid_request | invalid_client | invalid_grant`. The secret is compared in constant time. No CORS.
  Books must refuse `email_verified: false`.
- Rate limits: `RL_API_120` per IP on both public endpoints, `RL_API_30` per user on the approval call.
- The client is off until the Worker secret `BOOKS_OAUTH_CLIENT_SECRET` exists (same value as Books'
  `REVKLIK_OAUTH_CLIENT_SECRET`). `BOOKS_OAUTH_REDIRECT_URIS` is a comma list; production sets
  `https://books.revklik.com/auth/revklik/callback` in wrangler.jsonc, local dev adds
  `http://localhost:8787/auth/revklik/callback` in `.dev.vars`.
- The dashboard's account menu links to `https://books.revklik.com/auth/revklik/start` (`VITE_BOOKS_URL` overrides the
  base; self-hosted installs show the item only when it is set).

## Unfinished integrations

Shopee and Tokopedia answer 404 unless `MARKETPLACES_ENABLED=1`. Do not enable it before the placeholder partner
key and the unbound OAuth `state` are fixed. GSC OAuth uses HMAC-signed state (user, site, 10 minute expiry)
issued by `POST /api/gsc/auth-url`.
