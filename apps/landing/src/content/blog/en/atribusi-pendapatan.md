---
lang: en
title: "Revenue Attribution: Which Channels Actually Bring in Money"
description: "Traffic reports do not tell you which channel makes money. Here is how revenue attribution works, and how we calculate it in RevKlik."
ogDescription: "Compare channels by the money they bring in, not the traffic they send."
published: 2026-09-16
updated: 2026-10-30
readMinutes: 7
category: revenue
featured: true
related: [atribusi-revenue, funnel-konversi, revklik-vs-google-analytics]
draft: false
---

When you plan next month's budget, two channels in your dashboard look equally busy. Yet only one brings in buyers, and a dashboard that only counts visits cannot show which one. This is where revenue attribution comes in: the practice of connecting each sale back to the channel and touchpoint that produced it, then comparing channels by the money they brought in, not by the traffic they sent.

## What Is Revenue Attribution?

Here is a journey that happens often. Someone finds your blog article on Google, reads it, then leaves. Two weeks later they click a link in your newsletter, open the pricing page, and sign up. The following week they pay. Who closed that sale: Google, the newsletter, or both working together?

Without attribution, the credit usually falls to the last step, and the budget for the content that started it all gets cut first. That is an expensive decision, and it happens quietly every month.

## Why a Regular Traffic Report Does Not Answer This

Standard web analytics is good at counting: sessions, pageviews, referrers, devices, locations. What it does not do is connect those visits all the way to a transaction. Here are the three gaps we see most often:

- **Sessions are disconnected.** A visitor who finds you through an article and then buys through a newsletter link is recorded as two unrelated people. The article gets a pageview, the newsletter gets the conversion, and the channel that started the journey gets nothing.
- **Bounce rate punishes the wrong people.** A reader who finds a complete answer in one article and then leaves counts as a failure, even though that article may be the reason they come back and buy later.
- **Direct traffic hides the story.** A conversion labeled direct usually means someone typed your URL from memory or opened a saved link, after finding you somewhere that was not recorded. The dashboard rewards the last step and calls it the whole journey.

## Last-Touch or Multi-Touch?

An attribution model is basically just a rule for splitting credit for a single sale. The two most common families of models:

- **Last-touch** gives all the credit to the last touchpoint before the purchase. It is simple, easy to verify, and matches how most dashboards report data. Its blind spot: the channel that closes the sale is overvalued, while the channel that opens the journey is ignored. Branded search and direct visits look great, and the article that introduced you to the customer gets nothing.
- **Multi-touch** splits credit along the journey: the first touch for finding the customer, middle touches for keeping their interest, the last touch for closing. The picture is fairer, and the price is a weighting decision that has to stay consistent.

No model is right. Pick one, stay consistent, and compare channels with the same rules. Be ready to be a little surprised the first time you move away from last-touch: the channels that quietly start most journeys often deserve a bigger budget.

## How We Calculate Revenue Attribution in RevKlik

RevKlik puts user journeys, funnels, and revenue attribution in one dashboard. Here is what attribution needs to work:

1. **Journeys connected across visits.** Pages, UTM campaigns, and referrers are connected into one path per browser, so what you analyze is the whole journey, not loose sessions. The glue is a random first-party ID in the browser's local storage, which also lets a sale be tied to the visit that caused it, even days later.
2. **Revenue from two sources.** First, custom conversions that can carry a value: a single `klikapa.track('signup')` line from the browser, or events sent from your own server through the events API. Second, webhooks from the supported payment gateways: Midtrans, Xendit, DOKU, Mayar, Paywuz, Polar, Stripe, and Lemon Squeezy.
3. **Funnels to see the leaks.** Mark important parts of a page with the `data-section` attribute, and the scroll funnel shows where prospective buyers stop reading before they stop buying.

On privacy: RevKlik uses no third-party cookies, does no cross-site tracking, and builds no ad profiles. But the persistent ID above counts as personal data under the PDP Law, and you, as the site owner, are the data controller. The guidance is in [analytics and the PDP Law](/en/blog/analytics-patuh-uu-pdp) and [what actually changes without third-party cookies](/en/blog/analytics-tanpa-cookie).

## Start Small

You do not need a data warehouse team. Three steps for this week:

1. Define two or three conversion moments that matter to your business: signup, demo request, purchase. Record them as events.
2. Add UTMs to every campaign you run yourself and let referrer data cover the rest. If a source is labeled wrong, every report downstream is wrong too.
3. Make a habit of evaluating channels by the revenue they bring in, once a month, with the same attribution rule every time.

## Frequently Asked Questions

### Does revenue attribution need cookies?

It does not need third-party cookies. RevKlik keeps a random ID in local storage on your own domain (first-party, not a cookie) to combine a visitor's pageviews and actions into one journey. That ID is still personal data, so ask for consent if your audience includes Indonesian, EU or UK residents.

### Is last-touch attribution wrong?

No. It reliably shows which channel closes the sale, which is important information when you are improving your checkout or pricing page. What is wrong is making it your only measure, because the channels that start the journey, such as organic search and content, become invisible.

### Which plan includes revenue attribution?

The revenue and attribution panel is available from the Starter plan, Rp 64.000 per month, paid with QRIS (IDR) or card (USD). New accounts get a 7-day Growth trial with no credit card, including the revenue panel.
