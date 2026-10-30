---
lang: en
title: "Migrating from Plausible to RevKlik: 3 Steps"
description: "Move from Plausible to RevKlik in 3 steps: swap the script, recreate goals, connect a payment gateway for revenue attribution. No import of old data."
ogDescription: "Move from Plausible to RevKlik: swap the script, recreate goals, connect a payment gateway."
published: 2026-05-14
updated: 2026-10-30
readMinutes: 6
category: compare
featured: false
related: [migration-datafast, atribusi-pendapatan, analytics-tanpa-cookie]
draft: false
---

Plausible is a light, simple analytics tool. Plausible itself states that it uses no cookies, and its source code is open so you can run it on your own server. But as a business grows you may need more than pageviews and bounce rate: **how much revenue each page and channel generates**, how visitors move through a funnel, and where they drop off.

RevKlik was built for those questions. This post covers how to install it in place of Plausible. Plausible's features and pricing change over time, so check Plausible's own documentation and pricing page for a current comparison.

## 3 Migration Steps

### Step 1: Archive your Plausible data (optional)

RevKlik does not import data from Plausible. The only importer today is for OneDollarStats. Your old data stays in Plausible as long as your account is active. If you want an archive, use Plausible's data export and keep the file yourself. It cannot be loaded into RevKlik.

### Step 2: Swap the Plausible script

Open your site's HTML and find the Plausible script tag:

Before (Plausible):

```html
<script defer data-domain="yourdomain.com"
  src="https://plausible.io/js/script.js"></script>
```

After (RevKlik):

```html
<script defer data-site-id="YOUR-SITE-ID"
  src="https://app.revklik.com/klikapa.js"></script>
```

Remove one line, add one line, deploy. RevKlik starts recording as soon as visits come in. Plausible goals do not carry over. Recreate click goals with a `data-revklik-goal` attribute on the relevant element, for example `<button data-revklik-goal="signup">`.

### Step 3: Connect a payment gateway

In the RevKlik dashboard, open the **Integrations** page and connect the gateway you use: Midtrans, Xendit, DOKU, Mayar, Paywuz, Polar, Stripe, or Lemon Squeezy. Follow the instructions on that page (for example, registering a webhook endpoint in the gateway's dashboard). Once connected, payments are tied to the visit that caused them and show up as revenue per traffic source. Revenue attribution and funnels are available from the Starter plan.

## What RevKlik Offers

| | Micro | Starter | Growth |
|---|---|---|---|
| Price per month | Rp 16.000 ($1) | Rp 64.000 ($4) | Rp 192.000 ($12) |
| Events per month | 10,000 | 100,000 | 500,000 |
| Sites | 1 | 3 | 10 |
| Dashboard data window | 7 days | 30 days | 90 days |
| Raw event retention | 30 days | 60 days | 180 days |
| Revenue attribution and funnels | No | Yes | Yes |

Pay by QRIS (IDR) or card (USD). Growth has a 7-day trial with no card. RevKlik is a managed service on Cloudflare (data in the Asia-Pacific region), not software you install yourself. The RevKlik script is about 4 KB (gzip).

## Running Both at the Same Time

To compare numbers during the transition, add the RevKlik script next to the Plausible script:

```html
<!-- Plausible (temporary) -->
<script defer data-domain="yourdomain.com"
  src="https://plausible.io/js/script.js"></script>

<!-- RevKlik -->
<script defer data-site-id="YOUR-SITE-ID"
  src="https://app.revklik.com/klikapa.js"></script>
```

Once the RevKlik numbers look right (a few days), remove the Plausible script.

## Privacy

RevKlik uses no third-party cookies, no cross-site tracking, and no ad profiles. The tracker gives each browser a random ID kept in local storage on your own domain (first-party, not a cookie). A persistent ID can single out a returning visitor, so it counts as personal data under Indonesia's PDP Law (UU 27/2022) and GDPR. You, as the site owner, are the data controller, and RevKlik is your processor. Mention RevKlik and the retention periods in your privacy policy, and if your audience includes Indonesian, EU or UK residents, ask for consent before the tracker runs with `data-consent="required"` and `klikapa.consent(true)`. The tracker honours Global Privacy Control and Do Not Track. Read [analytics without third-party cookies](/en/blog/analytics-tanpa-cookie) for details.

## FAQ

### Will I lose my historical data?

No, your old data stays in Plausible. RevKlik does not import it, and starts collecting new data from the moment the script is installed.

### How long does the migration take?

Swapping the script takes a few minutes. Connecting a gateway and recreating goals depends on your setup.

### Can RevKlik be self-hosted like Plausible?

No. RevKlik is a managed service, so you do not run any servers, but you cannot run it yourself either.
