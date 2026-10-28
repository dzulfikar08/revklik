# Script Split + Popcorn Pricing Design

Date: 2026-05-15

## Summary

Split the klikapa.js tracking script into two bundles (core <1KB + full ~1.8KB gzipped) and introduce popcorn pricing (flat rate + overage) with three tiers: Micro ($1), Starter ($4), Growth ($12). The "<1KB" marketing claim becomes honest for Micro and Starter tiers.

---

## 1. Script Bundles

### Core Bundle (`klikapa.js`)

Served for Micro and Starter plan sites. Target: <1KB gzipped (~1.3KB raw).

Includes:
- Site ID extraction from `<script data-site-id>`
- Session ID (sessionStorage) + Visitor ID (localStorage)
- Device type detection (mobile/desktop/tablet only — single function, ~80B raw)
- UTM parameter parsing (source, medium, campaign, term, content)
- Pageview tracking (path, hostname, referrer, UTM)
- Batching queue with 1-second flush timer, max 10 events per batch
- SPA support (pushState, replaceState, popstate)
- Public API: `klikapa.pageview()`, `klikapa.track()`, `klikapa.conversion()`
- `beforeunload` flush

Excludes (compared to current script):
- Full device details (browser, OS, screen resolution, language)
- Scroll milestone tracking (25/50/75/90%)
- Section visibility tracking (`data-section`)
- Click tracking
- Heartbeat / time-on-page
- Identify API
- Heatmap lazy-load trigger

### Full Bundle (`klikapa.js?full`)

Served for Growth plan sites. Target: ~1.8KB gzipped (~5KB raw).

Includes everything in Core, plus:
- Full device detection (browser, OS, screen resolution, language)
- Scroll milestone tracking (25/50/75/90% depth)
- Section visibility tracking (`data-section` attribute monitoring)
- Click tracking (closest `a`, `button`, `[data-track]`)
- Heartbeat / time-on-page via `visibilitychange`
- `klikapa.identify()` API
- Heatmap lazy-load (`data-heatmap="true"` attribute)

### Serving Logic

The `/klikapa.js` endpoint checks the site's subscription plan:
- If plan is `micro` or `starter` → serve core bundle
- If plan is `growth` or higher → serve full bundle
- If site not found or no subscription → serve core bundle (safe default)

The server caches both bundles in memory. No filesystem reads per request.

---

## 2. Popcorn Pricing Model

### Tiers

| Plan | Price | Events/month | Overage | Sites | Script |
|---|---|---|---|---|---|
| Micro | $1/mo | 10,000 | $1 per 5K | 1 | Core |
| Starter | $4/mo | 100,000 | $2 per 50K | 3 | Core |
| Growth | $12/mo | 500,000 | $2 per 100K | 10 | Full |

No free tier. $1/mo is the entry point.

### Overage Billing

- Overage is tracked monthly based on event count per site
- When a site exceeds its included events, overage charges apply automatically
- Overage is billed at the end of each billing period via Polar metered billing
- Implementation: server tracks event count per site per month; webhook reports usage to Polar

### Features Per Tier

**Micro ($1):**
- Core script (<1KB gzipped)
- 1 site
- 10K events/month
- User journeys
- Basic dashboard
- UTM tracking

**Starter ($4):**
- Core script (<1KB gzipped)
- 3 sites
- 100K events/month
- Everything in Micro
- Funnel conversion
- Revenue attribution
- Real-time dashboard
- Cookieless attribution

**Growth ($12):**
- Full script (~1.8KB gzipped)
- 10 sites
- 500K events/month
- Everything in Starter
- AI insights
- Session replay + heatmaps
- Email & ads integrations
- Team management
- Mobile app
- Priority support
- API access & webhooks

---

## 3. Landing Page Changes

### Pricing Section

Replace the current 2-card layout (Starter $4 / Growth $12) with 3 cards:
- **Micro** — $1/mo, 10K events, 1 site, core features
- **Starter** — $4/mo, 100K events, 3 sites, marked as "Terpopuler"
- **Growth** — $12/mo, 500K events, 10 sites, full features

Each card shows included events + overage rate.

### Calculator Section

Update the event calculator slider to reflect new tiers:
- 0–10K → Micro ($1)
- 10K–100K → Starter ($4)
- 100K–500K → Growth ($12)
- 500K+ → "Custom" (contact us)

Show overage cost estimate when slider exceeds a tier's limit.

### Hero Strip

Keep "<1KB" claim — now honest since Micro and Starter use core bundle.
Add "$1/mo" as a new metric or update existing ones.

### Comparison Table

Keep RevKlik vs DataFast but update starting price to $1.

### CTAs

All CTAs remain pointing to `https://app.revklik.com/register`.

### i18n

All new text gets both `id` and `en` translations in the existing `T` object.

---

## 4. Server Changes

### billing.ts

Update `PLANS` object:
```typescript
const PLANS = {
  micro:   { name: "Micro",   price: 1,  events_per_month: 10000,  sites: 1,  script: "core", overage_per_events: 5000,   overage_price: 1  },
  starter: { name: "Starter", price: 4,  events_per_month: 100000, sites: 3,  script: "core", overage_per_events: 50000,  overage_price: 2  },
  growth:  { name: "Growth",  price: 12, events_per_month: 500000, sites: 10, script: "full", overage_per_events: 100000, overage_price: 2  },
} as const;
```

### Script Serving

Add endpoint logic (likely in the existing track endpoint or a static asset override):
- Parse `data-site-id` from request (via `Referer` header or query param)
- Look up site's subscription plan in DB
- Serve cached core or full bundle accordingly
- Set appropriate `Content-Type: application/javascript` and `Cache-Control` headers

### Polar Products

Create 3 Polar products:
- `POLAR_MICRO_PRODUCT_ID` for Micro plan
- `POLAR_STARTER_PRODUCT_ID` for Starter plan (already exists)
- `POLAR_GROWTH_PRODUCT_ID` for Growth plan (already exists)

### Overage Tracking

- Add `monthly_events` counter per site, reset monthly
- When events exceed plan limit, track overage units
- Report usage to Polar via metered billing API at billing period end

---

## 5. Scope

This spec covers:
- Script split into core + full bundles
- Pricing model redesign (3 tiers + overage)
- Landing page updates (pricing cards, calculator, hero, comparison, i18n)
- Server billing config updates
- Polar product setup

Out of scope (future work):
- Overage billing implementation detail (Polar metered billing integration)
- Dynamic script serving endpoint implementation
- Actual script minification and size verification
- Migration of existing subscribers to new tiers
