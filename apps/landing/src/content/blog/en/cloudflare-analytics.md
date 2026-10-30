---
lang: en
title: "Analytics on Cloudflare Workers and D1: What Changes from a Centralized Server"
description: "Analytics on a centralized server versus Cloudflare Workers and D1: how it works, how it is billed, where the limits are, and what it means for data location."
ogDescription: "What changes when analytics runs on Cloudflare Workers and D1, including limits and data location."
published: 2026-05-03
updated: 2026-10-30
readMinutes: 6
category: tech
featured: false
related: [cloudflare-workers-d1, benchmark-latensi, analytics-tanpa-cookie]
draft: false
---

Many classic analytics tools run ingestion and storage on centralized servers. Data from a visitor in Jakarta travels a long way to a data center in another region, gets processed, and is then read back from your dashboard.

Analytics that runs on an edge platform such as Cloudflare Workers changes part of that model. This article explains what actually changes in RevKlik, what does not, and where the limits are.

## Centralized Servers vs Cloudflare Workers

| Aspect | Centralized server | Cloudflare Workers + D1 |
|---|---|---|
| Receiving requests | Servers in one or a few regions | A Worker on Cloudflare's network, run near the database through smart placement |
| Scaling | You size the servers | The platform scales Workers automatically |
| Cost | Servers run even when traffic is low | Billing follows usage (see Cloudflare's pricing pages) |
| Single point of failure | Yes, if there is only one server | Managed by the platform, but a D1 database has one primary |
| Script size | Depends on the tool | RevKlik: about 4 KB (gzip) |

We leave latency and per-million-event cost figures out of this table because we have not published how they were measured. To measure for yourself, read [how heavy is an analytics script](/en/blog/benchmark-latensi).

## How Does RevKlik Run on Cloudflare?

There are three main components.

### 1. A Worker for ingestion

When a visitor loads your page, the tracker sends an event to the RevKlik Worker through `fetch()` with `keepalive: true`. The Worker validates the event and stores it.

One important note: our configuration uses smart placement, so the Worker runs near the D1 primary (Asia-Pacific) rather than always at the location closest to the visitor. The reason is that every sequential database query is slow when the Worker is far from the database. So not every request is "processed on the server closest to the visitor".

### 2. D1 for storage

Cloudflare D1 is a SQLite database managed by Cloudflare. It fits analytics well: each event becomes an inserted row, and the dashboard reads summaries with SQL queries (visitors, traffic sources, funnels, journeys). D1's size and operation limits follow Cloudflare's documentation and can change, so check the [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) before planning for high volume.

### 3. R2 for backups

We use Cloudflare R2 for database backups. Backups are encrypted (AES-256-GCM) and the last 30 daily backups are kept. We do not use R2 to archive raw events.

## About Cost

Workers and D1 bill by usage, with a free tier and a paid plan. Because the rates change, we do not print dollar figures here. See [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) for current numbers, then calculate with your own event volume.

One thing we can say from building RevKlik: usage-based infrastructure cost makes it easier for a small product to start without renting a fixed server. It is no guarantee that cost will be low at your volume.

## Why Does Event Delivery Matter for Accuracy?

How events are sent affects two things: site speed and data completeness.

**Site speed:** a script that blocks rendering or hogs the main thread slows the page, especially on mobile connections. The RevKlik tracker loads with `defer` and sends data in the background.

**Data completeness:** visitors who close the tab before the request finishes can cause lost events. The `keepalive: true` option on `fetch()` helps the request finish after the page closes, but no analytics tool guarantees every event arrives. Ad blockers, visitors who decline consent, and Do Not Track signals also affect the amount of data.

## What About Data Location?

RevKlik data is stored on Cloudflare infrastructure (D1 database, Asia-Pacific primary region), so it is processed outside Indonesia. This matters for your privacy notice:

- As the site owner you are the data controller and RevKlik is your processor.
- Under Indonesia's PDP Law (UU 27/2022), a persistent visitor ID counts as personal data, so name RevKlik, the first-party visitor ID, the retention periods, and the processing location in your privacy policy.
- Raw events are deleted automatically after 30 days (Micro), 60 days (Starter), or 180 days (Growth). You can also delete a single visitor's data, a whole site, or your account from Settings.

Edge hosting does not replace a lawful basis or visitor consent. Consent guidance is in [analytics without third-party cookies](/en/blog/analytics-tanpa-cookie). This is not legal advice.

## When Is This Approach a Poor Fit?

A few limits worth knowing:

- **Heavy queries over tens of millions of rows:** D1 suits per-site queries, but analysis that scans very large volumes belongs in a dedicated data warehouse.
- **Real-time machine learning:** if every event has to pass through a large model, Worker CPU and memory limits can get in the way.
- **Joining other data sources:** combining analytics data with a CRM or an external data warehouse needs a separate ETL pipeline.

## RevKlik on Cloudflare

RevKlik is built on Cloudflare Workers and D1, with R2 for backups. The tracker is about 4 KB (gzip), and a more detailed technical write-up is in [building a SaaS with Cloudflare Workers and D1](/en/blog/cloudflare-workers-d1).
