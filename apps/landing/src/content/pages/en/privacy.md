---
lang: en
title: Privacy Policy
description: What data RevKlik stores about your account and your site's visitors, for how long, where, and how to delete it.
updated: 2026-10-30
---

RevKlik is an analytics and revenue-tracking service from Joyo Digitama. This page explains what data we process, why, for how long, and what rights you have. We keep it plain: RevKlik is privacy-first, but it does not make personal data disappear.

In short: no third-party cookies, no cross-site tracking, no ad profiles, and we do not sell data.

## Our two roles

- **Your site visitors' data.** You are the data controller and RevKlik is your processor, working on your instructions.
- **Your RevKlik account data** (name, email, billing). Here Joyo Digitama acts as the data controller.

## What we store

For each site you install the script on, we store pageviews, custom events, sessions and visitor profiles, plus country, region and city from Cloudflare, and device, browser and OS. Visitors' names, emails and phone numbers are stored only if you send them yourself through `identify()`.

For your account, we store your name, email address, a hashed password (or a link to your Google account if you sign in with Google), and your subscription history. The dashboard uses a first-party session cookie to keep you signed in.

If you connect a payment gateway, we store the payment records needed for revenue attribution: transaction ID, amount, currency, time and fees. We do not store card numbers or sensitive payment details of your buyers.

## The visitor ID

RevKlik gives each browser a random ID, kept in the browser's local storage on your own domain (first-party, not a cookie). It lets you count returning visitors and tie a sale to the visit that caused it, even days later. The ID is random and is never shared between sites.

If the visitor clears browser storage, our server can still recognise them with a keyed hash (HMAC-SHA256 with a secret salt that is different for every site) of IP address, browser, language and screen size. The raw IP address is not stored, and the hash cannot be matched across sites.

A persistent ID can single out a returning visitor, so it counts as personal data under Indonesia's PDP Law (UU 27/2022) and GDPR. RevKlik keeps that data minimal; it does not make it disappear.

## Cookies and tracking

RevKlik uses no third-party cookies and does not track visitors across sites. We build no ad profiles and share no data for marketing. The script honours the Global Privacy Control (Sec-GPC) signal and Do Not Track by default.

## How long we keep data

Raw events are deleted automatically after 30 days (Micro), 60 days (Starter) or 180 days (Growth): twice the reporting window of the plan, with a 30-day minimum. Payment and revenue records stay as bookkeeping records until you delete the site or account.

## Deletion and backups

You can delete a single visitor's data, a whole site, or your account from Settings. Live data is removed immediately; payment records tied to a deleted visitor are kept but anonymised.

Database backups are encrypted (AES-256-GCM) and the last 30 daily backups are kept, so deleted data disappears from backups within 30 days.

## Where data is stored

Data is stored on Cloudflare infrastructure (D1 database, Asia-Pacific primary region), so it is processed outside Indonesia. If you are the controller for Indonesian visitors, say so in your own privacy notice.

## Third parties we use

- **Cloudflare**: hosting, database, backup storage, email delivery and inference for AI insights.
- **Pakasir** and **Polar**: process payments for your RevKlik subscription (QRIS and card). They receive the billing data needed for that transaction.
- **Google**: only if you sign in with Google or connect Search Console.
- **Your payment gateways** (Xendit, DOKU, Mayar, Paywuz, Polar): only if you connect them. We receive payment notifications, and for Mayar and Paywuz we also read your transaction list with your API key.

We do not have a standard data processing agreement (DPA) at the moment. If you need one, write to support@revklik.com.

## Guidance for site owners (not legal advice)

Under the PDP Law you need a lawful basis (consent is the safest) and a privacy notice that names the tools you use. We recommend:

- Mention RevKlik, the first-party visitor ID and the retention periods above in your privacy policy.
- If your audience includes Indonesian, EU or UK residents, ask for consent before the tracker runs. Add `data-consent="required"` to the script tag and call `klikapa.consent(true)` when the visitor accepts (until then nothing is stored and nothing is sent). If the visitor declines, call `klikapa.consent(false)`.
- Always get consent before calling `identify()` (name, email, phone) and before turning on heatmaps or session recordings; both are off until you set `window.klikapa_consent`.

The technical guide is in the [privacy docs](https://docs.revklik.com/privacy/).

## Your rights

You can ask for access, export (CSV from the dashboard), correction, deletion, or to object to processing of your data. Deleting visitor, site and account data is available directly in Settings. For anything else, write to support@revklik.com with the subject "Privacy request". We aim to reply within 14 business days.

## Changes to this policy

If we change this policy materially, we update the date above and tell account owners by email.

## Contact

Joyo Digitama, support@revklik.com.
