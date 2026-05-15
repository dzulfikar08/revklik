# RevKlik — Competitive Gap Analysis & Integration Roadmap

> **Date:** 2025-05-15
> **Scope:** RevKlik vs DataFast (datafa.st) feature comparison, Indonesian payment integration plan, and feature roadmap

---

## Table of Contents

1. [Competitive Positioning Summary](#1-competitive-positioning-summary)
2. [Feature Gap Analysis: What DataFast Has That We Don't](#2-feature-gap-analysis-what-datafast-has-that-we-dont)
3. [Our Unique Strengths](#3-our-unique-strengths)
4. [Indonesian Payment Provider Integration Plan](#4-indonesian-payment-provider-integration-plan)
5. [Feature Roadmap](#5-feature-roadmap)
6. [Technical Architecture for Payment Integrations](#6-technical-architecture-for-payment-integrations)

---

## 1. Competitive Positioning Summary

| Dimension | RevKlik (Us) | DataFast |
|-----------|-------------|----------|
| **Script Size** | < 1KB | 4KB |
| **Tracking Model** | Cookieless-first | Cookie-based (cookieless variant available) |
| **Infrastructure** | Cloudflare Workers (edge-native) | Tinybird (managed ClickHouse) |
| **Starting Price** | $1/month | $9/month |
| **Founder Brand** | Indie, Indonesian market focus | Marc Lou (200K+ followers, Product Hunt Maker of the Year) |
| **Heatmaps** | Yes (built-in) | No |
| **Session Replay** | Yes (built-in) | No |
| **Payment Integrations** | Polar only | Stripe, LemonSqueezy, Polar, Paddle, Shopify, WooCommerce + generic API |
| **Mobile App** | Yes (Capacitor) | Yes (native iOS/Android, Feb 2026) |
| **AI Features** | Llama 3.1 insights via Workers AI | Revenue predictions, AI funnel analysis |
| **API** | Public v1 REST API + CLI | Full REST API + playground + npm package |
| **Market** | Indonesia-first, global potential | Global, indie-hacker focused |

### Killer Differentiator

**We are the ONLY analytics platform with pageviews + heatmaps + session replay + revenue attribution in one product.**

DataFast explicitly lacks heatmaps and session replay, telling users to "use alongside Hotjar, FullStory, or Clarity." This is our strongest positioning angle.

---

## 2. Feature Gap Analysis: What DataFast Has That We Don't

### Priority 1: Revenue Attribution Ecosystem (Core to Our Value Prop)

| Feature | Description | Effort | Impact |
|---------|-------------|--------|--------|
| Multi-payment provider support | Integrate Stripe, LemonSqueezy, Paddle beyond Polar | High | Critical |
| Indonesian payment gateways | Midtrans, Xendit, DOKU integration | High | Critical (ID market) |
| Entry Pages Revenue | Which landing pages bring traffic AND revenue | Medium | High |
| Renewal Revenue Tracking | Track subscription renewals separately | Medium | High |
| UTM Filtering | Filter analytics by UTM source/medium/campaign | Medium | High |
| Channel Grouping | Auto-categorize traffic sources (Organic, Social, Email, etc.) | Medium | High |
| Currency Conversion | Display revenue in user's preferred currency | Low | Medium |
| Revenue Predictions (AI) | Score visitors by conversion probability | High | High |

### Priority 2: Dashboard & Analytics Features

| Feature | Description | Effort | Impact |
|---------|-------------|--------|--------|
| Advanced Filters | is/is not/contains operators on any dimension | Medium | High |
| Saved Segments | Save filter combinations as reusable segments | Medium | High |
| Notes/Annotations | Pin annotations on analytics charts | Low | Medium |
| Public Dashboard | Share analytics publicly via link | Low | High |
| Email Reports | Automated summary reports to inbox | Medium | High |
| Color Schemes | Customizable dashboard colors | Low | Low |
| Real-time 3D Globe | Interactive globe with visitor data | High | Medium |

### Priority 3: Integrations & Developer Ecosystem

| Feature | Description | Effort | Impact |
|---------|-------------|--------|--------|
| Google Search Console | Keyword revenue attribution | High | High |
| X/Twitter integration | Track tweets driving traffic/revenue | Medium | Medium |
| GitHub integration | Commit history overlaid on charts | Medium | Medium |
| Meta Ads ROAS | Ad spend + attributed revenue in dashboard | High | High |
| API Playground | Interactive API testing UI | Medium | Medium |
| npm Package | API access via npm module | Low | Medium |
| HTML attribute tracking | `data-revklik-goal` on any element, zero JS | Low | High |
| Scroll tracking via attributes | `data-revklik-scroll` with configurable threshold | Low | Medium |
| Platform install guides | Webflow, WordPress, Ghost, Wix, etc. | Low | High |

### Priority 4: Business & Growth

| Feature | Description | Effort | Impact |
|---------|-------------|--------|--------|
| Free trial (14-day) | Full feature access, no credit card | Low | High |
| Affiliate program | Commission for referrals | Medium | High |
| Platform-specific guides | 20+ platform installation docs | Low | Medium |
| Proxy guides (ad blocker bypass) | 13+ platform-specific proxy guides | Low | Medium |
| Data retention policy | 3-5 year retention tiers | Low | Medium |

---

## 3. Our Unique Strengths

### What DataFast Explicitly Lacks

1. **Heatmaps** — Built-in click heatmaps with element targeting and scroll depth analysis
2. **Session Replay** — Full session recording with event sequence reconstruction
3. **Cookieless by default** — No cookie consent headaches
4. **Ultra-light script** — <1KB vs DataFast's 4KB
5. **Cloudflare Workers edge-native** — Not a hosted service, true edge computing
6. **Push Notifications** — Native push notification alerts
7. **Biometric Auth** — Fingerprint/Face ID login on mobile
8. **Home Screen Widgets** — iOS/Android native widgets
9. **AI Insights (Llama 3.1)** — Revenue drivers, funnel optimization, geographic opportunities
10. **CLI Tool** — Terminal-based analytics (RevKlik CLI)
11. **Marketing Platform Integrations** — Mailchimp, ConvertKit, Beehiiv
12. **Indonesian Market First** — Localized language, pricing, payment methods

### Positioning Statement

> **RevKlik** — The only analytics platform that gives you pageviews, heatmaps, session replay, and revenue attribution in a single <1KB script. Built for the Indonesian market. Priced for everyone.

---

## 4. Indonesian Payment Provider Integration Plan

### 4.1 Strategy

**Approach: Aggregator-first, not individual provider.**

Instead of integrating each e-wallet and bank individually, we integrate the top payment gateways that aggregate ALL Indonesian payment methods through a single API. This gives us:

- Virtual Accounts (BCA, BRI, Mandiri, BNI)
- E-wallets (GoPay, OVO, DANA, ShopeePay, LinkAja)
- QRIS (universal QR — one code for ALL wallets)
- Credit/debit cards
- BNPL (Kredivo, Akulaku)

### 4.2 Integration Priority

#### Tier 1: Must-Have (Highest Indonesian Market Coverage)

| Provider | Coverage | API Quality | Webhooks | Recurring | Effort |
|----------|----------|-------------|----------|-----------|--------|
| **Midtrans** | 95%+ of Indonesian payment methods | Excellent (SNAP-compliant) | Yes (configurable) | Yes (full subscription API) | 2-3 weeks |
| **Xendit** | 90%+ of Indonesian payment methods | Excellent (versioned API) | Yes (event-based) | Yes (recurring plans API) | 2-3 weeks |

> **Midtrans + Xendit together cover essentially every Indonesian payment method.** Both support Bank Indonesia's SNAP standard, so the callback formats are similar.

#### Tier 2: Should-Have (Additional Coverage)

| Provider | Coverage | API Quality | Webhooks | Recurring | Effort |
|----------|----------|-------------|----------|-----------|--------|
| **DOKU** | 85%+ (oldest gateway, SNAP + non-SNAP) | Good | Yes (callbacks) | Limited | 1-2 weeks |
| **NICEPAY** | 80%+ (strong e-wallet aggregation) | Good (SNAP) | Yes | Yes | 1-2 weeks |
| **Flip** | Focus on VA + disbursement | Good (v2/v3) | Yes | No | 1 week |

#### Tier 3: Direct Platform Integrations

| Provider | Type | API | Effort |
|----------|------|-----|--------|
| **Shopee** | E-commerce marketplace | Open Platform API | 2-3 weeks |
| **Tokopedia/TikTok Shop** | E-commerce marketplace | Developer API | 2-3 weeks |
| **WooCommerce ID** | E-commerce platform (~27K stores in ID) | WooCommerce REST API | 1-2 weeks |
| **QRIS Direct** | Universal QR payment | Via aggregators | Included in Tier 1 |

### 4.3 Implementation Details

#### Midtrans Integration

```
Flow: User's site → Midtrans checkout → Payment success → Midtrans webhook → RevKlik revenue event

Webhook payload includes:
- transaction_status (capture, settlement, pending, deny, cancel, expire, refund)
- payment_type (credit_card, bank_transfer, gopay, qris, kredivo, etc.)
- gross_amount (IDR)
- order_id (merchant reference)
- custom_field1-3 (for embedding analytics metadata: session_id, utm_source, etc.)

Revenue attribution:
- custom_field1 → session_id → visitor → UTM params → channel
- custom_field2 → campaign_id
- custom_field3 → referrer
```

#### Xendit Integration

```
Flow: User's site → Xendit invoice → Payment callback → Xendit webhook → RevKlik revenue event

Webhook events:
- invoice.paid → one-time revenue
- invoice.expired → abandoned checkout tracking
- recurring.cycle → recurring revenue tracking

Revenue attribution:
- Invoice metadata → session_id → visitor → channel attribution
- Supports IDR, USD, and other currencies
```

#### Revenue Tracking Script (User's Side)

```html
<!-- User adds this alongside RevKlik tracking script -->
<script>
  // Midtrans: pass analytics session into custom fields
  snap.pay(token, {
    custom_field1: revklik.getSessionId(),
    custom_field2: revklik.getUtmSource(),
    custom_field3: revklik.getUtmCampaign()
  });

  // Xendit: pass metadata into invoice
  xendit.createInvoice({
    metadata: {
      revklik_session: revklik.getSessionId(),
      revklik_utm_source: revklik.getUtmSource()
    }
  });
</script>
```

### 4.4 What This Unlocks for Indonesian Users

| Feature | Value |
|---------|-------|
| **Revenue by payment method** | "70% of revenue comes via GoPay, 20% QRIS, 10% VA" |
| **Revenue by e-wallet** | Compare GoPay vs OVO vs ShopeePay revenue |
| **Revenue by bank** | "BCA VA drives 60% of bank transfer revenue" |
| **QRIS performance** | Track QR code payment revenue across all wallets |
| **BNPL revenue** | Track Kredivo/Akulaku installment revenue |
| **Subscription revenue** | Track recurring Midtrans/Xendit subscriptions |
| **Marketplace revenue** | Revenue from Shopee/Tokopedia orders |
| **Indonesian Rupiah (IDR) native** | All revenue in IDR, with USD conversion option |

---

## 5. Feature Roadmap

### Phase 1: Core Revenue Attribution (Weeks 1-4)

- [ ] **Indonesian payment gateway: Midtrans integration**
  - Webhook endpoint for payment notifications
  - Revenue event creation with payment method breakdown
  - Custom field mapping for session → visitor → channel attribution
  - Dashboard: revenue by payment method, by e-wallet, by bank
  - IDR currency support

- [ ] **Indonesian payment gateway: Xendit integration**
  - Same webhook-based approach as Midtrans
  - Invoice/recurring event mapping
  - Revenue attribution flow

- [ ] **UTM Filtering**
  - Filter analytics by utm_source, utm_medium, utm_campaign
  - Add to all dashboard views

- [ ] **Channel Grouping**
  - Auto-categorize: Organic Search, Social Media, Email, Direct, Referral, Paid
  - Revenue per channel

- [ ] **Entry Pages Revenue**
  - Show which landing pages drive revenue, not just traffic

### Phase 2: Dashboard Power Features (Weeks 5-8)

- [ ] **Advanced Filters**
  - is / is not / contains operators
  - Apply to any dimension (country, device, referrer, page, etc.)

- [ ] **Saved Segments**
  - Save filter combinations as reusable segments
  - Quick segment switching

- [ ] **Public Dashboard**
  - Generate shareable link for public analytics
  - Building-in-public use case

- [ ] **Email Reports**
  - Daily/weekly/monthly summary reports
  - Key metrics + trend changes
  - Send via Cloudflare Workers email

- [ ] **Notes/Annotations**
  - Pin notes on specific dates in charts
  - Track launches, campaigns, changes

- [ ] **HTML Attribute Tracking**
  - `data-revklik-goal="purchase"` on any element
  - `data-revklik-scroll="0.75"` for scroll depth
  - Zero JavaScript required for basic tracking

### Phase 3: Global Payment + Integrations (Weeks 9-14)

- [ ] **Stripe integration** (global)
- [ ] **LemonSqueezy integration** (global)
- [ ] **DOKU integration** (Indonesian)
- [ ] **NICEPAY integration** (Indonesian)
- [ ] **Google Search Console** keyword revenue attribution
- [ ] **Meta Ads ROAS** ad spend + attributed revenue
- [ ] **WooCommerce plugin** (for Indonesian + global stores)
- [ ] **Shopify app** (global)

### Phase 4: Developer Ecosystem & Growth (Weeks 15-20)

- [ ] **API Playground** — interactive API testing UI
- [ ] **npm Package** — `@revklik/sdk` for Node.js
- [ ] **Platform install guides** — WordPress, Webflow, Ghost, Wix, Squarespace, Next.js, etc.
- [ ] **Proxy guides** — ad blocker bypass for 10+ platforms
- [ ] **Affiliate program** — referral commission system
- [ ] **14-day free trial** — full feature access
- [ ] **Revenue Predictions (AI)** — visitor conversion probability scoring

### Phase 5: Advanced Analytics (Weeks 21+)

- [ ] **Renewal Revenue Tracking** — separate recurring from one-time
- [ ] **Currency Conversion** — multi-currency display
- [ ] **X/Twitter Integration** — tweet overlay on charts
- [ ] **GitHub Integration** — commit overlay on charts
- [ ] **Color Schemes** — customizable dashboard
- [ ] **Shopee marketplace integration** (Indonesian)
- [ ] **Tokopedia/TikTok Shop integration** (Indonesian)

---

## 6. Technical Architecture for Payment Integrations

### Current Architecture

```
User's Website
  ├── RevKlik tracking script (< 1KB)
  │   ├── Pageviews
  │   ├── Custom events
  │   ├── Conversions
  │   └── Session data
  │
  └── Polar checkout (existing)
      └── Polar webhook → RevKlik API → Revenue event
```

### Target Architecture

```
User's Website
  ├── RevKlik tracking script (< 1KB)
  │   ├── Pageviews, events, conversions, sessions
  │   ├── getSessionId() → exposes for payment metadata
  │   ├── getUtmSource() → exposes for payment metadata
  │   └── getUtmCampaign() → exposes for payment metadata
  │
  ├── Payment Providers (any of):
  │   ├── Polar checkout → Polar webhook → /api/webhooks/polar
  │   ├── Midtrans checkout → Midtrans webhook → /api/webhooks/midtrans
  │   ├── Xendit invoice → Xendit webhook → /api/webhooks/xendit
  │   ├── DOKU checkout → DOKU callback → /api/webhooks/doku
  │   ├── NICEPAY checkout → NICEPAY callback → /api/webhooks/nicepay
  │   ├── Stripe checkout → Stripe webhook → /api/webhooks/stripe
  │   ├── LemonSqueezy → LS webhook → /api/webhooks/lemonsqueezy
  │   ├── Shopee order → Shopee callback → /api/webhooks/shopee
  │   └── Generic Payment API → POST /api/v1/payment
  │
  └── All webhooks land on:
      Cloudflare Worker
        ├── Verify webhook signature (per provider)
        ├── Extract payment amount, currency, method
        ├── Extract session_id from custom fields
        ├── Look up visitor → UTM params → channel
        ├── Create revenue event in D1
        └── Trigger real-time SSE update
```

### Database Schema Additions

```sql
-- Payment provider configurations per site
CREATE TABLE payment_providers (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  provider TEXT NOT NULL, -- 'midtrans', 'xendit', 'doku', 'nicepay', 'stripe', etc.
  config TEXT NOT NULL,   -- JSON: { server_key, client_key, webhook_secret, etc. }
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (site_id) REFERENCES sites(id)
);

-- Revenue events with payment method breakdown
-- (extends existing events table)
ALTER TABLE events ADD COLUMN payment_provider TEXT;
ALTER TABLE events ADD COLUMN payment_method TEXT;   -- 'gopay', 'qris', 'va_bca', 'credit_card', etc.
ALTER TABLE events ADD COLUMN currency TEXT DEFAULT 'USD';
ALTER TABLE events ADD COLUMN subscription_id TEXT;  -- for recurring revenue

-- Webhook delivery log
CREATE TABLE webhook_logs (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT DEFAULT 'pending', -- 'pending', 'processed', 'failed'
  error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  processed_at TEXT
);
```

### New API Endpoints

```
# Webhook receivers (one per provider)
POST /api/webhooks/midtrans      → Midtrans payment notifications
POST /api/webhooks/xendit        → Xendit payment events
POST /api/webhooks/doku          → DOKU payment callbacks
POST /api/webhooks/nicepay       → NICEPAY payment callbacks
POST /api/webhooks/stripe        → Stripe payment events
POST /api/webhooks/lemonsqueezy  → LemonSqueezy payment events

# Payment provider management (authenticated)
GET    /api/v1/sites/:id/payment-providers           → List configured providers
POST   /api/v1/sites/:id/payment-providers           → Add provider config
PUT    /api/v1/sites/:id/payment-providers/:provider  → Update config
DELETE /api/v1/sites/:id/payment-providers/:provider  → Remove provider

# Revenue analytics (new endpoints)
GET /api/v1/sites/:id/revenue/by-channel     → Revenue grouped by traffic channel
GET /api/v1/sites/:id/revenue/by-method      → Revenue grouped by payment method
GET /api/v1/sites/:id/revenue/by-provider    → Revenue grouped by payment provider
GET /api/v1/sites/:id/revenue/entry-pages    → Revenue by landing page
GET /api/v1/sites/:id/revenue/recurring      → Recurring revenue breakdown

# Tracking script API additions
window.revklik.getSessionId()      → Returns current session ID
window.revklik.getUtmSource()      → Returns current UTM source
window.revklik.getUtmMedium()      → Returns current UTM medium
window.revklik.getUtmCampaign()    → Returns current UTM campaign
```

---

## Appendix: Indonesian Payment Market Context

### Market Landscape

- **E-wallet users in Indonesia:** 200M+ (2024)
- **QRIS adoption:** Government-mandated, 25M+ merchants
- **Preferred payment methods:** GoPay, OVO, ShopeePay, QRIS, Bank VA
- **Credit card penetration:** ~17M cards (low penetration, e-wallets dominate)
- **E-commerce GMV:** $60B+ annually
- **SaaS adoption:** Growing rapidly, WooCommerce dominant for independent stores

### Why This Matters for RevKlik

1. **No analytics platform currently offers Indonesian payment attribution** — this is a blue ocean
2. **Indonesian merchants are underserved** — global tools (GA, Mixpanel) don't support local payment methods
3. **Midtrans + Xendit integration alone covers 95%+ of payment methods** — high impact, focused effort
4. **Price advantage ($1-12/month)** fits Indonesian market purchasing power
5. **Bahasa Indonesia localization** builds trust and reduces friction

### Key Insight

DataFast focused on Stripe/LemonSqueezy/Paddle because they serve Western indie hackers. By focusing on Midtrans/Xendit/DOKU, we capture the Indonesian market that **no analytics platform currently serves with revenue attribution.**

This is our **geographic moat** — DataFast would need to completely rethink their integration strategy to serve Indonesian merchants, while we build it natively from day one.
