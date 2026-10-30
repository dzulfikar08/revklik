---
lang: en
title: "RevKlik vs Google Analytics 4: Which Fits Indonesian SaaS?"
description: "RevKlik vs GA4 compared: script size, revenue attribution, privacy, and pricing. For founders and makers who want to know which channel actually makes money."
ogDescription: "RevKlik vs GA4 for SaaS founders: script, revenue attribution, privacy, and pricing."
published: 2026-05-14
updated: 2026-10-30
readMinutes: 7
category: compare
featured: false
related: [atribusi-pendapatan, analytics-tanpa-cookie, migration-plausible]
draft: false
---

Google Analytics 4 (GA4) is free, familiar, and good enough for many sites. But if you are building a SaaS or digital product and need to know **which channel makes money**, not just how many pageviews you got, there are a few things worth weighing.

This post compares the two from the angle of founders and makers: **script size, revenue attribution, privacy, and day-to-day use**. GA4 details change with Google's policies, so check Google's documentation for current figures.

## Comparison Summary

| Aspect | RevKlik | Google Analytics 4 |
|---|---|---|
| Script size | About 4 KB (gzip) | Larger. Measure it yourself in your browser's Network tab |
| Revenue attribution | Connect a gateway: Xendit, DOKU, Mayar, Paywuz, Polar | Purchase events are sent from your site. Deeper analysis usually goes through BigQuery export or Looker Studio |
| Privacy | No third-party cookies, random first-party visitor ID, consent can be required with `data-consent="required"` | Uses first-party cookies. Google provides Consent Mode to adjust behaviour based on consent |
| Dashboard | One dashboard focused on revenue, funnels, and traffic sources | Very comprehensive, but takes time to learn |
| Price | Rp 16.000, Rp 64.000, or Rp 192.000 per month | Free for standard properties, with Google's quotas |
| Setup | One line of script | Google tag, often through Google Tag Manager |
| Funnels | Built-in multi-step funnels and scroll depth (from Starter) | Through Exploration reports |

## 1. Performance: Script Size

The RevKlik script is about 4 KB after gzip and loads with `defer`, so it does not block the page. Google's script (`gtag.js`) is larger, and its size depends on the tags you enable. The honest way to compare: open your page, look at the Network tab, and measure the effect on LCP on your own site, because the result depends on your site and your visitors' networks.

## 2. Revenue Attribution

This is the biggest difference in how the two work.

**GA4** can record purchase events, but you have to send them from your site or backend. For deeper revenue-per-campaign analysis, many teams export data to BigQuery and visualise it in Looker Studio. That is flexible, but it takes technical skill and setup time.

**RevKlik** is built with revenue as the focus. Connect your payment gateway in the Integrations menu (Xendit, DOKU, Mayar, Paywuz, or Polar), and payments are tied to the visit that caused them. You can see:

- Which UTM source and campaign generate revenue
- The pages visited before payment
- The funnel from first visit to payment
- Revenue per channel and per campaign

Revenue attribution and funnels are available from the Starter plan. The dashboard shows a 7-day (Micro), 30-day (Starter), or 90-day (Growth) data window. Read [revenue attribution](/en/blog/atribusi-pendapatan) for how it works.

## 3. Privacy and Consent

GA4 uses first-party cookies to recognise visitors. If your audience includes Indonesian, EU or UK residents, you need a lawful basis (consent is the safest) and a privacy notice that names the tools you use. Google Consent Mode helps adjust tag behaviour based on the visitor's choice.

RevKlik uses no third-party cookies, no cross-site tracking, and no ad profiles. The tracker gives each browser a random ID kept in local storage on your own domain (first-party, not a cookie), never shared between sites. If a visitor clears browser storage, our server can still recognise them with a keyed hash (HMAC-SHA256 with a secret salt that is different for every site) of IP address, browser, language and screen size. The raw IP address is not stored.

A persistent ID can single out a returning visitor, so it counts as personal data under Indonesia's PDP Law (UU 27/2022) and GDPR. RevKlik keeps that data minimal; it does not make it disappear. You are the data controller and RevKlik is your processor. What we recommend:

- Mention RevKlik, the first-party visitor ID and the retention periods in your privacy policy.
- If your audience includes Indonesian, EU or UK residents, ask for consent before the tracker runs: add `data-consent="required"` to the script tag and call `klikapa.consent(true)` when the visitor accepts, or `klikapa.consent(false)` if they decline.
- Get consent before calling `identify()` (name, email, phone).
- The tracker honours Global Privacy Control and Do Not Track by default.

Raw events are deleted automatically after 30 days (Micro), 60 days (Starter), or 180 days (Growth). Data is stored on Cloudflare infrastructure (Asia-Pacific primary region), so it is processed outside Indonesia. Say so in your privacy notice. This is not legal advice. Details are in [analytics without third-party cookies](/en/blog/analytics-tanpa-cookie).

## 4. Day-to-Day Use

GA4 is comprehensive but known for a learning curve. A question like "how much revenue did campaign X bring in this month?" usually takes an Exploration report and a few filters. RevKlik is designed so that question is answered right in the dashboard: traffic sources, campaigns, funnels, and revenue per channel in one place.

## 5. When to Choose GA4

GA4 fits better if:

- Your analytics budget is zero.
- Your team has an analyst who is comfortable with BigQuery and Looker Studio.
- You need deep integration with the Google ecosystem (Ads, Search Console).
- Your site is a content site that does not need to track revenue.

## 6. When to Choose RevKlik

RevKlik fits better if:

- You sell something (SaaS, digital product, subscription) and need to know which channel makes money.
- You want a light script that does not block the page.
- Your team is small and has no time to learn GA4 in depth.
- You want to see funnels and conversions visually.
- You prefer paying in rupiah via QRIS.

## FAQ

### Can I run RevKlik alongside GA4?

Yes. Many people run both during the transition. Add the RevKlik script next to the Google tag, compare the numbers, then decide.

### How do I move from GA4 to RevKlik?

Add one line of the RevKlik script to your site. RevKlik does not import historical data from GA4. If you want to keep your old data, export it from GA4 or BigQuery yourself. For a step-by-step guide, read [migrating from Plausible](/en/blog/migration-plausible), where the steps are the same.

### Which gateways are supported for revenue attribution?

Xendit, DOKU, Mayar, Paywuz, and Polar. Connect them from the Integrations menu.
