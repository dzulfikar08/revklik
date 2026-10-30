# Privacy and data lifecycle

What RevKlik stores about visitors, how long, and how it is removed. The public wording lives in the landing, docs and legal pages; this file is the engineering source of truth they must match.

## What is stored per visitor

| Where | Data |
|---|---|
| Visitor's browser | `_kp_vid` (random UUID, `localStorage`), `_kp_sid` and `_kp_utm` (`sessionStorage`), and `_kp_consent` once consent was granted. All first-party, on the customer's own domain. No cookies are set. |
| `events`, `sessions` | Page, referrer, UTM, country/region/city from Cloudflare, device type, browser, OS, and a per-site salted fingerprint. Revenue fields on payment events. |
| `visitor_profiles` | The visitor id, first/last seen, counters, the same fingerprint, and `name`, `email`, `phone`, `avatar` only when the site owner calls `identify()`. |
| `heatmap_*`, `session_recordings` | Only when the owner enabled them and the page set `window.klikapa_consent`. |
| Not stored | The raw IP address. It is read to derive the fingerprint and discarded. |

## Per-site salted fingerprint

`lib/visitor-hash.ts`: `fingerprint = "s1_" + first 32 hex of HMAC-SHA256(site_salt, SHA-256(ip | user-agent | accept-language | screen))`.

- `sites.visitor_salt` is 32 random bytes per site, created on first use, never returned by any route. The same device gets unrelated values on two sites, and nothing can be matched across sites or reversed without the salt.
- It is used for the owner's self-traffic exclusion list and as an opaque fallback identifier. Visitor identity across days is the random `_kp_vid`, not the fingerprint.
- Before this change the stored value was a bare SHA-256 of the same inputs with no salt. Anyone holding a database copy could test an IP against it.

### Migration tradeoff (schema v25)

| Data | What happens | Cost |
|---|---|---|
| `_kp_vid` in browsers | Untouched. Returning visitors, journeys and revenue attribution continue across the change. | None. |
| Self-traffic blocklists (`sites.excluded_fingerprints`) and the rows they point at | Re-keyed in the migration: `HMAC(salt, old_digest)` equals what a fresh request from that device now produces. A blocked device stays blocked and its history stays purgeable. | None. |
| Fingerprints on all other events, sessions and profiles | Set to NULL by the nightly `fingerprint-scrub` job (resumable, a few thousand rows per slice). | The "purge history of this device" action cannot find pre-v25 rows for devices that were not on the blocklist. Nothing else read these columns. |

Re-keying every legacy row instead would keep a link from old to new fingerprints, which defeats the point of salting.

## Retention (nightly `retention-purge`, enabled by default)

Window = 2 x the plan's reporting window, minimum 30 days (the dashboard compares each period with the one before it, so it needs twice the window):

| Plan | Reporting window | Raw data deleted after |
|---|---|---|
| Micro | 7 days | 30 days |
| Starter | 30 days | 60 days |
| Growth | 90 days | 180 days |

Deleted: `events`, `sessions`, `visitor_profiles` (by last seen), `crawler_hits`, `session_recordings`, `heatmap_clicks`, `heatmap_scrolls`, `webhook_logs`. **Kept:** payment events (money not zero, or a provider reference). They are bookkeeping records, removed only when the site or account is deleted, and anonymised when their visitor is erased.

Super admins are never purged. Self-hosted installs keep everything unless `RETENTION_HARD_DELETE_DAYS` is set (30 or more); hosted installs ignore that variable. A run that spends its statement budget resumes after the last finished site the next night.

## Deletion

| Scope | Endpoint | Effect |
|---|---|---|
| One visitor | `DELETE /api/sites/:siteId/visitors/:visitorId` (owner, admin, editor) | Deletes events, sessions, profile (name/email/phone), heatmap rows and recordings in one transaction. Payment events stay with props, fingerprint, city, region, browser, OS and device removed and `visitor_id` replaced by `erased:<event id>`. |
| Access request | `GET /api/sites/:siteId/visitors/:visitorId/export` | Profile, sessions and events as JSON. |
| One site | `DELETE /api/sites/:siteId` | Every site table, in chunks (202 until drained). |
| Account | `DELETE /api/auth/account` body `{confirm_email, current_password}` | Password re-entry (Google-only accounts: a sign-in under 10 minutes old). Revokes the Polar subscription first and aborts with 502 if that fails. Then deletes every owned site with its data, tokens, subscription, team memberships, push devices and prefs, fee rules, usage, affiliate rows and linked accounts. Own-billing QRIS orders stay with `user_id = 'deleted'` (replay protection for webhooks). 202 for a very large account: repeat the same request. |

Backups keep a deleted record for up to 30 days (see `backup-restore.md`). The payment processor keeps its own records as an independent controller.

## Tracker controls

- `data-consent="required"` on the script tag: nothing is stored or sent until `klikapa.consent(true)`; the grant is remembered in `_kp_consent`. `klikapa.consent(false)` erases `_kp_vid`, `_kp_sid`, `_kp_utm`, `_kp_consent` and stops sending. All three shipped variants (`klikapa.js`, `klikapa-full.js`, `klikapa-core.js`).
- Global Privacy Control and Do Not Track are honoured with no opt-out: the tracker stores and sends nothing, and `/api/track` also drops requests carrying `Sec-GPC: 1` or `DNT: 1`.
- Heatmaps and recordings stay opt-in through `window.klikapa_consent = { heatmap, recording }`.

## Deploy steps

1. `wrangler secret put BACKUP_ENCRYPTION_KEY` (see `backup-restore.md`). Without it the 03:00 job fails by design.
2. Deploy. The v25 migration runs on the first request (adds `sites.visitor_salt`, `integrations.synced_through`, re-keys blocklists). The new `30 3 * * *` trigger is created from `wrangler.jsonc`.
3. First nightly runs: the backup deletes old plaintext dumps after the first encrypted dump is stored; the retention purge deletes data past 30/60/180 days (the oldest events date from April, so expect a large first delete spread over a few nights).
4. Run `bun scripts/restore-drill.ts` once, and `--file` on the first real encrypted dump.
