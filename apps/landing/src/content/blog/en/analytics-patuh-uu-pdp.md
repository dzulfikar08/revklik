---
lang: en
title: "Analytics and Indonesia's PDP Law: A Practical Guide for Site Owners"
description: "A practical PDP Law guide for web analytics: controller and processor, consent, retention, deletion and data location. Not an automatic compliance promise."
ogDescription: "Controller and processor, consent, retention, deletion and data location for your site's analytics."
published: 2026-05-16
updated: 2026-10-30
readMinutes: 8
category: privacy
featured: false
related: [analytics-tanpa-cookie, revklik-vs-google-analytics, funnel-konversi]
draft: false
---

Law No. 27 of 2022 on Personal Data Protection (UU PDP, the PDP Law) applies to site owners who process visitor data, including through analytics tools. No tool makes you compliant automatically. Compliance comes from your own decisions: a lawful basis, a privacy notice, a retention period, and a way to handle deletion requests. An analytics tool can make those decisions easier or harder.

This article is not legal advice. For complicated situations, ask a lawyer.

## Who is responsible: controller and processor

The PDP Law distinguishes two roles:

- The **data controller** decides why and how data is processed. For your site's visitor data, that is you.
- The **data processor** processes data on the controller's behalf. For an analytics tool you install, that is the analytics provider. For RevKlik, RevKlik is your processor.

So the duty to establish a lawful basis and inform visitors sits with you, not with the tool vendor.

## Is analytics data personal data?

Often, yes. A persistent visitor ID can single out a returning visitor, so it counts as personal data under the PDP Law. The same goes for IP addresses and device identifiers. This applies to an ID in local storage as well, not only to cookies.

For example, RevKlik gives each browser a random ID in local storage on your own domain, and does not share it between sites. Our server stores IP addresses only as a keyed hash with a secret per-site salt. Even so, that ID is still personal data. RevKlik keeps the data minimal; it does not make it disappear.

So do not write in your privacy policy that your analytics "collects no personal data". Write what is actually stored.

## Consent

The PDP Law requires a lawful basis for processing. Consent is the safest basis, and the easiest to prove.

What we recommend:

1. Mention RevKlik, the first-party visitor ID, and the retention periods (below) in your privacy policy.
2. If your audience includes Indonesian, EU or UK residents, ask for consent before the tracker runs.
3. Always get consent before calling `identify()` (name, email, phone), and before turning on heatmaps or session recordings.

In RevKlik, add `data-consent="required"` to the script tag and call `klikapa.consent(true)` when the visitor accepts. Until then nothing is stored and nothing is sent. If the visitor declines, call `klikapa.consent(false)`.

```html
<script defer data-site-id="your-site-id" data-consent="required"
  src="https://app.revklik.com/klikapa.js"></script>
```

```js
// Called from the buttons in your consent banner
document.querySelector('#accept').addEventListener('click', () => klikapa.consent(true));
document.querySelector('#decline').addEventListener('click', () => klikapa.consent(false));
```

Heatmaps and session recordings stay off until you set `window.klikapa_consent`. The tracker also honours Global Privacy Control (Sec-GPC) and Do Not Track by default.

A careless consent banner (one that auto-accepts after a few seconds, for instance) does not help you. If you add a banner, make sure "decline" really stops tracking.

## Retention: how long data is kept

The PDP Law expects data not to be kept longer than needed. In RevKlik we store pageviews, custom events, sessions and visitor profiles for your site, plus country, region and city from Cloudflare, and device, browser and OS. Names, emails and phone numbers are stored only if you send them through `identify()`.

Raw events are deleted automatically after:

| Plan | Raw event retention |
| --- | --- |
| Micro | 30 days |
| Starter | 60 days |
| Growth | 180 days |

That is twice the plan's reporting window, with a 30-day minimum. Payment and revenue records stay as bookkeeping records until you delete the site or account. Put both in your privacy policy.

## Deletion and backups

Visitors can ask for their data to be deleted. From Settings you can delete a single visitor's data, a whole site, or your account. Live data is removed immediately. Payment records tied to a deleted visitor are kept but anonymised.

Database backups are encrypted (AES-256-GCM) and the last 30 daily backups are kept, so deleted data disappears from backups within 30 days. If a visitor asks, that is the honest answer.

## Data location

Data is stored on Cloudflare infrastructure (D1 database, Asia-Pacific primary region), so it is processed outside Indonesia. Say so in your privacy notice. Other analytics tools have their own storage locations, so ask the same question of any provider you evaluate.

## Penalties

The PDP Law has administrative sanctions and criminal provisions. Administrative sanctions include fines of up to 2% of annual revenue (Article 57), alongside written warnings and suspension of processing. Read the statute itself for current details.

## A checklist for your site

1. List every tracker on your site (analytics, ad pixels, session recording). Check the source code or use a tracker-detection extension.
2. Decide the lawful basis for each one. For visitors from Indonesia, the EU or the UK, set up consent.
3. Update your privacy policy: tool names, data types, the ID on the visitor's device, retention, data location, and how to request deletion.
4. Set `data-consent="required"` and connect it to your banner.
5. Do not call `identify()` before consent.
6. Prepare an internal procedure for visitor deletion requests.

For a feature and privacy comparison of tools, see [RevKlik vs Google Analytics](/en/blog/revklik-vs-google-analytics). For the first-party ID and third-party cookie question, read [what actually changes without third-party cookies](/en/blog/analytics-tanpa-cookie).
