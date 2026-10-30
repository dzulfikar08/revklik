---
lang: en
title: "How to Build a Conversion Funnel the Right Way for Online Businesses in Indonesia"
description: "A guide to building a conversion funnel: set the goal, map the steps, find where visitors stop, and read RevKlik's scroll funnel from data-section markers."
ogDescription: "How to define funnel steps, find where visitors stop, and read RevKlik's scroll funnel."
published: 2026-05-08
updated: 2026-10-30
readMinutes: 7
category: guide
featured: false
related: [analytics-untuk-umkm, atribusi-pendapatan, cloudflare-workers-d1]
draft: false
---

Most online business owners know their conversion rate. Few know **at which step** visitors decide to leave. A conversion funnel answers that question, and the answer often differs from what you expected.

This guide covers how to think about funnels: defining the right steps, seeing where visitors stop, and fixing the weakest point. In the middle we explain what RevKlik's funnel panel does and what it does not.

## What Is a Conversion Funnel?

A conversion funnel is a picture of a visitor's path from the start to a specific goal, such as signing up, subscribing, or buying. Each stage is one step on that path, and each stage loses some visitors.

A made-up example of a simple SaaS funnel (the numbers are illustrative, not real data):

| Stage | Count | Drop-off from previous stage |
|---|---|---|
| Visits the landing page | 10,000 | n/a |
| Clicks the sign-up button | 2,500 | 75% |
| Fills in the signup form | 1,200 | 52% |
| Finishes onboarding | 600 | 50% |
| Subscribes to a paid plan | 120 | 80% |

Of 10,000 visitors, 120 subscribe, so the overall conversion rate is 1.2%. That number alone does not tell you what to fix. **What helps is seeing that 75% of visitors do not click the sign-up button.** That is the biggest bottleneck in this example.

## Step 1: Define Your Funnel Goal

Before building a funnel, answer first: **which action is most valuable to your business?**

A few examples:

- **Signup:** a visitor creates an account.
- **Activation:** a user finishes first setup, such as creating a project or connecting data.
- **Paid conversion:** a user upgrades to a paid plan.
- **Purchase:** a visitor completes checkout for a specific product.

Each goal needs its own funnel. Do not build one funnel for everything.

## Step 2: Map Every Step

Write down every step a visitor takes from the start to the goal, and be specific. "Visits the website" is too general. "Opens the pricing page from a Google ad" is far more useful.

An example signup funnel for a SaaS:

1. Lands on the homepage (from Google Ads, UTM: `utm_source=google`)
2. Clicks "See Pricing"
3. Opens the pricing page
4. Clicks the sign-up button on one of the plans
5. Enters email and password
6. Verifies the email
7. Finishes onboarding

Each step should be trackable as a separate occurrence, whether as a pageview, a click, or a custom event.

## Step 3: Measure Every Stage

Pageviews alone are not enough. A pageview does not tell you whether a visitor interacted with the page or closed it immediately.

RevKlik captures interaction in three ways:

- **Custom events:** send them from your code with one line.

  ```js
  klikapa.track('signup_started', { plan: 'starter' });
  ```

- **Conversions with a value:** `klikapa.conversion('checkout', 150000)` records a conversion together with its revenue.
- **Goal markers in HTML:** a `data-revklik-goal` attribute on a button or link records the goal when it is clicked.

Custom events show up in each visitor's profile and timeline in the dashboard, so you can trace which steps one person took or skipped.

## What RevKlik's Funnel Panel Does

The **scroll funnel** panel in the dashboard works from page-section markers, not from steps you assemble by hand. Add `data-section` to the sections of your page:

```html
<section data-section="hero">...</section>
<section data-section="features">...</section>
<section data-section="pricing">...</section>
<section data-section="signup">...</section>
```

The tracker records which sections a visitor reads. The panel shows how many visitors reached each section, the percentage that stopped between two sections, and the overall conversion rate (the share of visitors who reached the last section). If your site has several pages, there is a tab per page. The funnel is built from pageview and `scroll_section` events, is available from the Starter plan, and follows the 7, 30, or 90 day data window. Details are in the [funnel documentation](https://docs.revklik.com/dashboard/funnels/).

The limit is worth knowing: the panel shows how far visitors read down your page. It is not a multi-page funnel with steps you define yourself. For a funnel like the signup example above, use custom events and the visitor timeline, or calculate it yourself from your data.

## Step 4: Find the Bottleneck

The bottleneck is the stage with the **highest drop-off**, where the share of visitors who continue is smallest.

No drop-off figure automatically means "good" or "bad", because the result depends on the type of business and the traffic source. Compare stages within your own funnel, and compare your funnel week over week.

Do not optimise every stage at once. Start with the biggest bottleneck. Fixing a stage that almost every visitor already passes gives a small return.

## Step 5: Optimise Based on Data

After finding the bottleneck, form a hypothesis about why visitors stop, then test fixes one at a time.

Example hypotheses and fixes:

| Bottleneck | Likely cause | Fix to test |
|---|---|---|
| Many do not press the sign-up button on the homepage | The headline is not relevant enough | Test a more specific headline |
| Many stop at the signup form | Too many fields | Cut fields, ask for extra info later |
| Many do not finish onboarding | Too many steps | Shorten the steps |
| Many do not upgrade to a paid plan | The product's value is not visible during the trial | Show advanced features earlier |

## Funnel vs User Journey: What Is the Difference?

A **funnel** is the path you expect visitors to follow: linear, toward conversion. A **user journey** is the path they actually take, including detours, pages visited repeatedly, and dead ends.

Both matter. A funnel tells you where the problem is, and the journey helps you guess why, because you can see what the visitor did before and after that point.

For example, if many visitors stop at the pricing page, look at their journeys. Did they go back to the homepage? Open the features page first? Leave straight away? That context is not in the funnel alone.

## Common Funnel Mistakes

1. **Too many steps.** A funnel with 15 stages is hard to read and act on. Start with a few main steps.
2. **Not tracking custom events.** Button clicks and form submits need to be tracked separately from pageviews.
3. **Ignoring traffic source.** Visitors from ads, social media, and email behave differently. Segment your funnel by source.
4. **Optimising the wrong stage.** Fixing a stage that almost every visitor already passes gives a small return. Focus on the bottleneck.
5. **Not measuring over time.** Watch the funnel weekly or monthly. A change in drop-off can signal a technical problem or a market shift.

## Connecting the Funnel to Revenue

A funnel shows where visitors stop. To find out which channel ends up producing sales, connect it with [revenue attribution](/en/blog/atribusi-pendapatan). If you use Midtrans, Xendit, DOKU, Mayar, Paywuz, Polar, Stripe, or Lemon Squeezy, RevKlik can tie a payment to the visit that led to it.

If you are just starting, [analytics for small businesses](/en/blog/analytics-untuk-umkm) explains the basic metrics to watch first. To see how it looks, open the [product demo](https://app.revklik.com/demo).
