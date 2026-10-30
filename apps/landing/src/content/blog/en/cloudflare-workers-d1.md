---
lang: en
title: "Building an Analytics SaaS with Cloudflare Workers + D1"
description: "Technical notes on building a multi-tenant SaaS with Cloudflare Workers, D1, and R2: RevKlik architecture, an example SQL schema, and tenancy patterns."
ogDescription: "RevKlik's architecture on Workers, D1, and R2, with an example schema and SQL queries."
published: 2026-04-20
updated: 2026-10-30
readMinutes: 10
category: tech
featured: false
related: [cloudflare-analytics, benchmark-latensi, funnel-konversi]
draft: false
---

RevKlik is built on Cloudflare: Workers for compute, D1 for the database, R2 for backups. This article explains how we put it together, with an example schema and queries you can use as a starting point for your own product.

## Why Cloudflare for SaaS?

Common choices for a SaaS are AWS, GCP, or Vercel with a managed database such as PlanetScale or Supabase. All of them work. Cloudflare offers a different model, with several building blocks on one platform:

| Need | Cloudflare component |
|---|---|
| Compute | Workers |
| Relational database | D1 (SQLite) |
| Object storage | R2 |
| Static assets and CDN | Workers Static Assets |
| Scheduled jobs | Cron Triggers |

Billing follows usage, with free and paid plans. Rates change over time, so we do not print a price comparison here. Work it out from [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) when you plan, using your own volume.

## The RevKlik Architecture

RevKlik has three main components.

### 1. The tracking script (client side)

A vanilla JavaScript script installed on the customer's site. It is about 4 KB (gzip) and sends events through `fetch()` with `keepalive: true`, so the request still completes when the visitor navigates away.

The script captures:

- Pageviews (automatic)
- UTM parameters from the URL
- A session ID (kept in `sessionStorage`)
- A random visitor ID (kept in `localStorage` on the site's own domain, first-party, not a cookie)
- Custom events (called manually with `klikapa.track()`)

Because a persistent visitor ID counts as personal data under the PDP Law (UU 27/2022), site owners need to mention it in their privacy policy and ask for consent where required. Details are in [analytics without third-party cookies](/en/blog/analytics-tanpa-cookie).

### 2. The Worker (ingestion and API)

One Worker receives events from the tracker, validates them, and stores them in D1. The same Worker serves the dashboard API and receives webhooks from the supported payment gateways (Midtrans, Xendit, DOKU, Mayar, Paywuz, Polar, Stripe, and Lemon Squeezy) for revenue attribution.

Our configuration uses smart placement: the Worker runs near the D1 primary in Asia-Pacific. The reason is that sequential database queries get slow when the Worker is far from the database.

### 3. The dashboard

The dashboard is a single-page web app served as static assets from the same Worker, with `/api/*` routes handled by the Worker. Every API route that reads site data first checks that the site belongs to the logged-in user, then runs the D1 query.

Cron Triggers run scheduled tasks: database backups (encrypted, stored in R2), order syncing, and retrying notifications.

## An Example Schema in D1

D1 uses SQLite, so an ordinary relational schema works. The schema below is a simplified example to illustrate the pattern, not a copy of RevKlik's production schema:

```sql
-- Main table for events
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  visitor_id TEXT,
  timestamp INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  path TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  revenue REAL,
  props TEXT, -- JSON string
  referrer TEXT
);

-- Indexes for frequently used queries
CREATE INDEX idx_events_tenant_session
  ON events(tenant_id, session_id, timestamp);

CREATE INDEX idx_events_tenant_type
  ON events(tenant_id, event_type, timestamp);

-- Sessions table for aggregation
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  visitor_id TEXT,
  started_at INTEGER,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  referrer TEXT,
  event_count INTEGER DEFAULT 1,
  converted INTEGER DEFAULT 0
);
```

The right index is the biggest factor in D1 query speed. With an index on `(tenant_id, session_id, timestamp)`, rebuilding one session does not need to scan the whole table. Measure it yourself with `EXPLAIN QUERY PLAN` on your own data.

## Multi-Tenancy: Two Approaches

For a multi-tenant SaaS there are two common patterns.

### Approach A: one database with tenant_id

One D1 database for all customers. Every table has a `tenant_id` column, and every query includes a `WHERE tenant_id = ?` filter.

**Pros:** simple, one database to manage, easy cross-customer analysis for the platform owner.

**Cons:** data isolation depends on query discipline. A single query without the tenant filter can leak data.

### Approach B: one database per customer

Each customer gets their own D1 database. Cloudflare lets you create and bind databases programmatically.

**Pros:** stronger data isolation, and per-customer performance is separate.

**Cons:** more complex setup, and cross-customer analysis needs manual aggregation.

RevKlik uses one shared database (Approach A) for simplicity, with a site-ownership check in every API route.

## The Queries That Matter Most

All examples below use the simple schema above.

### User journey

Rebuild a visitor's path from one session:

```sql
SELECT path, event_type, timestamp, props
FROM events
WHERE tenant_id = ? AND session_id = ?
ORDER BY timestamp ASC;
```

Most visited pages:

```sql
SELECT path, COUNT(*) AS hits
FROM events
WHERE tenant_id = ?
  AND timestamp > ?
GROUP BY path
ORDER BY hits DESC
LIMIT 20;
```

### Revenue attribution

Total revenue per UTM source:

```sql
SELECT utm_source, utm_medium,
       SUM(revenue) AS total_revenue,
       COUNT(DISTINCT session_id) AS sessions
FROM events
WHERE tenant_id = ?
  AND revenue IS NOT NULL
  AND timestamp > ?
GROUP BY utm_source, utm_medium
ORDER BY total_revenue DESC;
```

### A funnel with steps you define

Count how many sessions pass each step:

```sql
WITH funnel AS (
  SELECT session_id,
    MAX(CASE WHEN path = '/pricing' THEN 1 ELSE 0 END) AS step1,
    MAX(CASE WHEN event_type = 'signup' THEN 1 ELSE 0 END) AS step2,
    MAX(CASE WHEN event_type = 'purchase' THEN 1 ELSE 0 END) AS step3
  FROM events
  WHERE tenant_id = ? AND timestamp > ?
  GROUP BY session_id
)
SELECT
  SUM(step1) AS saw_pricing,
  SUM(step2) AS signed_up,
  SUM(step3) AS purchased
FROM funnel;
```

This is an example query pattern for your own SaaS. The funnel panel in the RevKlik dashboard works differently: it reads how far visitors scroll down a page, based on `data-section` markers (see [conversion funnels](/en/blog/funnel-konversi)).

## About Performance

We do not publish a latency table for this article, because we have not documented how it would be measured. A few practices help:

- Use indexes that match your query patterns, then check with `EXPLAIN QUERY PLAN`.
- For high volume, compute summaries ahead of time with Cron Triggers and store them in a separate table, instead of recomputing every time the dashboard opens.
- Measure queries on your own data and location. D1 has one primary, so the distance from the Worker to the primary affects results.

## Recommendations for Getting Started

1. **Use Hono.** It is light, written in TypeScript, and runs on Workers. RevKlik uses it.
2. **Start with one shared database.** One D1 with `tenant_id` is enough to begin. Move to a database per customer only if isolation requirements demand it.
3. **Use R2 for backups.** Encrypted backups in R2 give you a way to recover if something goes wrong.
4. **Add Cron Triggers for aggregation.** Compute the numbers that get opened often (daily visitors, revenue per source) on a schedule.
5. **Handle payment webhooks in the same Worker.** One Worker can serve both tracking events and payment webhooks without a separate service.

## Limits to Know About

Platform limits change over time, so consult the official docs when you plan: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and [D1 limits](https://developers.cloudflare.com/d1/platform/limits/). Things you should always check:

- **Worker size:** there is a size limit per Worker.
- **CPU time per request:** the limit differs between the free and paid plans. Heavy D1 queries can approach it, so pre-aggregate.
- **D1 database size:** there is a limit per database. Plan to delete or archive old data. In RevKlik, raw events are deleted automatically after 30, 60, or 180 days depending on the plan.
- **Real-time connections:** a plain Worker does not hold connection state. For a real-time dashboard, use polling or Durable Objects.

## Conclusion

Workers, D1, and R2 form a stack that a small team can operate simply: one platform for compute, database, storage, and schedules. Our biggest lessons were to understand placement (Worker and D1 primary) and to set up indexes from the start.

To see the result as a product, visit the [RevKlik demo](https://app.revklik.com/demo). For the analytics side of the story, read [analytics on Cloudflare Workers and D1](/en/blog/cloudflare-analytics).
