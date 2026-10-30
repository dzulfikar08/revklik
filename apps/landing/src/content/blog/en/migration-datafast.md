---
lang: en
title: "Migrating from DataFast to RevKlik: Steps and Comparison"
description: "Moving from DataFast to RevKlik: swap one script, recreate your goals, connect a payment gateway. Plus a table of what RevKlik offers on each plan."
ogDescription: "Moving from DataFast to RevKlik: swap the script, recreate goals, connect a payment gateway."
published: 2026-05-14
updated: 2026-10-30
readMinutes: 6
category: compare
featured: false
related: [migration-plausible, atribusi-pendapatan, analytics-tanpa-cookie]
draft: false
---

DataFast is a lightweight web analytics tool focused on speed. If you are weighing a move, the useful question is not "which is faster" but **how visitors interact with your site** and **how much revenue each channel generates**.

This post covers how to install RevKlik in place of DataFast, what carries over and what does not, and what RevKlik offers on each plan. We do not compare DataFast's price or features line by line, because both change. Check DataFast's own pricing page before you decide.

## When Moving Makes Sense

RevKlik fits if you want:

- **Revenue attribution** that ties payments from your gateway (Midtrans, Xendit, DOKU, Mayar, Paywuz, Polar, Stripe, Lemon Squeezy) to the traffic source and the visitor's journey.
- **Multi-step funnels** and scroll depth in one dashboard.
- **Local subscription payments**: Rp 16.000, Rp 64.000, or Rp 192.000 per month via QRIS (or card in USD).

If all you need is simple visitor stats and DataFast already covers it, there is no urgent reason to move.

## 3 Migration Steps

### Step 1: Get the RevKlik script

Create a RevKlik account and add your site. The dashboard gives you a unique script for that site:

```html
<script defer data-site-id="YOUR-SITE-ID"
  src="https://app.revklik.com/klikapa.js"></script>
```

### Step 2: Swap the DataFast script

Open your site's code, remove the DataFast script, and put the RevKlik script in the same place.

Before (DataFast):

```html
<script defer data-website-id="YOUR-DATAFAST-ID"
  src="https://datafast.app/insights.js"></script>
```

After (RevKlik):

```html
<script defer data-site-id="YOUR-SITE-ID"
  src="https://app.revklik.com/klikapa.js"></script>
```

Deploy the change. New data shows up in the RevKlik dashboard as soon as visits come in.

### Step 3: Recreate goals and connect payments

RevKlik has no importer for DataFast. Goals do not carry over, so recreate them on your site. For click goals, add a `data-revklik-goal` attribute to the relevant element:

```html
<button data-revklik-goal="signup">Sign up</button>
```

For scroll depth, use the `data-revklik-scroll` attribute. For revenue attribution, open **Integrations** and connect the gateway you use. Supported gateways: Midtrans, Xendit, DOKU, Mayar, Paywuz, Polar, Stripe, and Lemon Squeezy. Revenue attribution and funnels are available from the Starter plan.

## What RevKlik Offers on Each Plan

| | Micro | Starter | Growth |
|---|---|---|---|
| Price per month | Rp 16.000 ($1) | Rp 64.000 ($4) | Rp 192.000 ($12) |
| Events per month | 10,000 | 100,000 | 500,000 |
| Sites | 1 | 3 | 10 |
| Dashboard data window | 7 days | 30 days | 90 days |
| Raw event retention | 30 days | 60 days | 180 days |
| Revenue attribution and funnels | No | Yes | Yes |

Pay by QRIS (IDR) or card (USD). The Growth plan has a 7-day trial with no card.

## Privacy

RevKlik uses no third-party cookies, no cross-site tracking, and no ad profiles. The tracker gives each browser a random ID kept in local storage on your own domain (first-party, not a cookie). A persistent ID can single out a returning visitor, so it counts as personal data under Indonesia's PDP Law (UU 27/2022), and you, as the site owner, are the data controller. If your audience includes Indonesian, EU or UK residents, add `data-consent="required"` to the script tag and call `klikapa.consent(true)` when the visitor accepts. More in [analytics without third-party cookies](/en/blog/analytics-tanpa-cookie).

## FAQ

### How long does the migration take?

Swapping the script takes a few minutes. Recreating goals and connecting your gateway depends on how many you have.

### Does my old data come with me?

No. RevKlik does not import data from DataFast, so your history stays in DataFast and RevKlik starts recording from the moment the script is installed. The only importer today is for OneDollarStats.

### Can I run both at the same time?

Yes. Add the RevKlik script next to the DataFast script during the transition, compare the numbers for a few days, then remove the DataFast script.

### What about technical support?

Support goes through the [support](/en/support) page.
