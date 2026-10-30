---
lang: en
title: "No Third-Party Cookies: What Actually Changes for Your Analytics"
description: "No third-party cookies does not mean no personal data. How a first-party ID in local storage works, what changes, and what stays your responsibility."
ogDescription: "No third-party cookies does not mean no personal data. Here is the difference."
published: 2026-05-12
updated: 2026-10-30
readMinutes: 6
category: privacy
featured: false
related: [analytics-patuh-uu-pdp, revklik-vs-google-analytics, atribusi-pendapatan]
draft: false
---

"Cookieless analytics" is often used as if it meant no visitor data is stored at all. That is wrong, and under privacy law the mistake can cost you. This article separates three things that get mixed up: third-party cookies, first-party cookies, and browser local storage. Then we explain what RevKlik does and what it does not.

## Third-party cookies, first-party cookies, and local storage

- **Third-party cookies** are set by another domain, such as an ad network, and read across many sites. They enable cross-site tracking and ad profiles. Safari and Firefox block them by default.
- **First-party cookies** are set by your own site's domain, for example a login session cookie. Only that site reads them.
- **Local storage** is browser storage scoped to one domain. It is not a cookie, but for analytics it does a similar job: it keeps an ID on the visitor's device.

Most of the "death of cookies" debate is about the first kind. The other two are not automatically free of privacy questions.

## What RevKlik does

RevKlik uses no third-party cookies, does no cross-site tracking, and builds no ad profiles. It does give each browser a random ID, kept in local storage on your own domain (first-party, not a cookie). The ID is not a name or an email, and it is never shared between sites.

The ID has one purpose: counting returning visitors and tying a sale to the visit that caused it, even days later. Without a persistent ID, revenue attribution is not possible.

If a visitor clears browser storage, our server can still recognise them with a keyed hash (HMAC-SHA256 with a secret salt that is different for every site) of IP address, browser, language and screen size. The raw IP address is not stored, and the hash cannot be matched across sites.

## Is this personal data?

Yes, treat it as personal data. A persistent ID can single out a returning visitor, so it counts as personal data under Indonesia's PDP Law (UU 27/2022) and GDPR. RevKlik keeps that data minimal; it does not make it disappear. In practice:

- You are the data controller for your visitors' data. RevKlik is your processor.
- You need a lawful basis (consent is the safest) and a privacy notice that names the tools you use.
- Storing an ID on the visitor's device, whether in a cookie or in local storage, is something your privacy policy should account for.

The full discussion is in our [practical guide to the PDP Law for analytics](/en/blog/analytics-patuh-uu-pdp). This is not legal advice.

## What changes, what does not

What changes when you use analytics without third-party cookies:

- Your visitors' data does not feed ad profiles on other sites.
- Nothing depends on cookies owned by an ad network, so browser blocking does not break it.
- You can still count returning visitors in the same browser and tie sales to their source.

What does not change:

- You still process personal data, and you still need a legal basis and a privacy notice.
- One person on two devices still looks like two visitors. You can link them only if you send an identity through `identify()`, and that requires consent first.
- A visitor who declines consent, or who sends Global Privacy Control, must not be tracked. RevKlik honours GPC and Do Not Track by default.

## When to ask for consent

If your audience includes Indonesian, EU or UK residents, ask for consent before the tracker runs. Add `data-consent="required"` to the script tag and call `klikapa.consent(true)` when the visitor accepts. Until then nothing is stored and nothing is sent. If the visitor declines, call `klikapa.consent(false)`.

```html
<script defer data-site-id="your-site-id" data-consent="required"
  src="https://app.revklik.com/klikapa.js"></script>
```

## Bottom line

"No third-party cookies" is a claim you can stand behind. "No personal data" is not. Choose an analytics tool by looking at what it actually stores on the visitor's device and on its servers, then write that into your privacy policy.
