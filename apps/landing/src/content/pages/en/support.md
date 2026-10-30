---
lang: en
title: Support
description: Quick answers about RevKlik and how to reach our team by email.
updated: 2026-10-30
---

Look for your answer below, or write to [support@revklik.com](mailto:support@revklik.com). We aim to reply within 2 business days. Include your site's domain and, if you have one, a screenshot of the problem.

## Common questions

### What is RevKlik?

Analytics that matches payments from your payment gateway to the traffic source behind each buyer, so you know which channel makes money. The tracking script is about 4 KB (gzip).

### How do I install the script?

Paste one line of script before `</head>` on your site. Per-platform guides (Next.js, Astro, WordPress, Shopify, Webflow, Google Tag Manager) are in the [docs](https://docs.revklik.com/getting-started/).

### No data shows in my dashboard. What should I check?

- An ad blocker or Content Security Policy blocking `app.revklik.com`.
- The Site ID in the script differs from the site you are viewing in the dashboard.
- The site domain in RevKlik does not match the domain visitors open.
- If you use `data-consent="required"`, nothing is sent until `klikapa.consent(true)` is called.

### Do I need a consent banner?

RevKlik uses no third-party cookies and does not track across sites, but a persistent visitor ID is personal data under Indonesia's PDP Law. If your audience includes Indonesian, EU, or UK residents, we recommend asking for consent before the tracker runs. Details are in the [Privacy Policy](/en/privacy). This is not legal advice.

### How does revenue attribution work?

Connect your payment gateway (Midtrans, Xendit, DOKU, Mayar, Paywuz, Polar, Stripe, or Lemon Squeezy) through a webhook. Each payment is tied to the visitor's journey, so you see the source, campaign, and page that produced the revenue. Revenue attribution is available from the Starter plan.

### Is there a free plan?

There is no permanent free plan. Every new account gets a 7-day trial with all Growth features and no credit card. After that, Micro is $1 per month, Starter $4, and Growth $12. You can pay by QRIS or card (USD).

### How do I delete my data or account?

Open Settings. You can delete one visitor's data, a whole site, or your account. Retention and backup details are in the [Privacy Policy](/en/privacy).

## Contact us

- Email: [support@revklik.com](mailto:support@revklik.com)
- Privacy requests: put "Privacy request" in the email subject.
- Source code and bug reports: [GitHub](https://github.com/dzulfikar08/revklik/issues)
