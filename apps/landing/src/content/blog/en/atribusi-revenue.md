---
lang: en
title: "Revenue Attribution: How to Find Out Where Your Money Comes From"
description: "Many founders do not know which channel actually makes money. How to build a simple revenue attribution system with UTMs and payment webhooks."
ogDescription: "Build simple revenue attribution with consistent UTMs and payment webhooks."
published: 2026-04-28
updated: 2026-10-30
readMinutes: 8
category: revenue
featured: false
related: [atribusi-pendapatan, funnel-konversi, analytics-tanpa-cookie]
draft: false
---

The most basic question in business: **where does our money come from?** "From customers" is not enough of an answer. What you need to know is which marketing channel, which campaign, and which page actually generates revenue.

Many SaaS founders do not know the answer for sure. They may know the overall conversion rate, but cannot say "30% of this month's revenue came from Google ads for keyword X." Without revenue attribution, you can waste money on channels that do not work and underinvest in the channels that actually deliver.

## What Is Revenue Attribution?

Revenue attribution is the process of linking every rupiah (or dollar) of revenue to its source: a specific ad, an email campaign, a social media post, or an organic page. It answers: "If I stop spending money on channel X, how much revenue do I lose?"

Without attribution, budget decisions rest on guesswork. With attribution, they rest on data. For a more conceptual take, also read [revenue attribution: which channels actually bring in money](/en/blog/atribusi-pendapatan).

## Attribution Models: Which One Is Right?

There are several attribution models you can use. The most common:

| Model | How it works | When to use it |
| --- | --- | --- |
| First-touch | All credit goes to the first interaction | Measuring brand awareness |
| Last-touch | All credit goes to the last interaction | Measuring direct conversions |
| Linear | Credit is split evenly across all touchpoints | A simple, general overview |
| Time-decay | The closer to the conversion, the more credit | Long sales cycles |

For most SaaS products, **last-touch with UTM context** is the most practical starting point. It tells you which page or campaign leads directly to a payment. Once that works, you can add first-touch and time-decay for a fuller picture.

## How to Build a Simple Attribution System

You do not need an expensive tool to get started. What you need:

### 1. Consistent UTM Tracking

Every link that points to your site should have UTM parameters. At a minimum: `utm_source`, `utm_medium`, `utm_campaign`.

Examples:

- Google ad: `?utm_source=google&utm_medium=cpc&utm_campaign=analytics-saas`
- Twitter: `?utm_source=twitter&utm_medium=social&utm_campaign=launch-announcement`
- Email newsletter: `?utm_source=newsletter&utm_medium=email&utm_campaign=weekly-digest`

Store these UTM parameters as soon as the visitor lands. Do not only track them on the first pageview. Keep them, so that when the visitor converts 3 days later, the UTM is still on record.

### 2. Connect a Payment Webhook

This is the step most often missed. You cannot attribute revenue from page analytics alone. You need to know **when and how much** was paid.

The easiest way: connect a webhook from your payment gateway to your analytics system. RevKlik supports Midtrans, Xendit, DOKU, Mayar, Paywuz, Polar, Stripe, and Lemon Squeezy. Every time a payment succeeds, the webhook sends the amount and the product to analytics.

If your sales do not go through one of those gateways, send them yourself as custom conversions: `klikapa.track` from the browser, or events from your own server through the events API, with the transaction value.

On the analytics side, the payment is tied to the visit that caused it. Now every rupiah can be traced back to its source UTM.

### 3. Build a Simple Report

With linked UTM and payment data, you can build a report like this. The numbers are made up, for illustration only:

| Source | Visitors | Revenue | Conv. rate | Rev/visitor |
| --- | --- | --- | --- | --- |
| Google Ads | 3,200 | $1,840 | 2.1% | $0.58 |
| Twitter organic | 5,100 | $890 | 0.8% | $0.17 |
| Email newsletter | 1,400 | $2,200 | 5.2% | $1.57 |
| Direct/none | 2,800 | $1,100 | 1.5% | $0.39 |

The example makes it clear: the newsletter produces the highest revenue per visitor. If you only look at traffic volume, you might think Twitter matters more. Revenue attribution can show the opposite.

## Common Attribution Problems

### Dark Social

Not all traffic can be tracked with UTMs. If someone shares your link in a WhatsApp group or a Slack DM without a UTM, it shows up as "direct" in analytics. For B2B SaaS, that share can be significant.

A partial solution: use a unique URL per channel (not just UTMs) and track more specific parameters. Also accept that attribution will not be perfect, and that imperfect attribution is still more useful than none.

### Multi-Touch Cycles

A visitor might see a Google ad, read a blog post, receive an email, and only subscribe 2 weeks later. The last-touch model records only "email" as the source. The first-touch model records only "Google Ads."

The solution: start with last-touch, then add user journey tracking to see every touchpoint before conversion. RevKlik connects visits from the same browser, so you can see not only the start and end points but the steps in between.

### Cross-Device

A visitor finds you on their phone during a commute, but subscribes from a laptop at home. RevKlik's random ID is stored per browser, so these two devices look like two different visitors.

The solution: if users log in on your site, you can send their identity through `identify()` so devices that use the same account are linked. Because that is personal data (name, email, phone), call `identify()` only after the visitor has given consent.

## Revenue Attribution in RevKlik

What RevKlik handles from the process above:

- UTMs are captured when a visitor lands and stored with their journey.
- Webhooks from the supported gateways tie each payment to the visit that caused it.
- The full user journey shows every step from the first visit to the payment.
- Revenue reports can be grouped by source, medium, or campaign.

To connect visits across days, RevKlik uses a random first-party ID in local storage. RevKlik uses no third-party cookies and does no cross-site tracking, but that persistent ID counts as personal data under the PDP Law. You are the data controller. Read [analytics and the PDP Law](/en/blog/analytics-patuh-uu-pdp) before you install.

Revenue attribution is available from the Starter plan.

## Start Simple

Do not try to build a perfect attribution system on day one. Start with:

1. Put UTMs on every marketing link.
2. Connect the payment webhook to analytics.
3. Check the weekly last-touch attribution report.
4. After 1 to 2 months, add multi-touch analysis.

Consistent UTMs and a connected webhook already give far better insight than no attribution at all. After that, a [conversion funnel](/en/blog/funnel-konversi) helps you find the step where prospective buyers drop off.
