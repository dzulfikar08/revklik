---
lang: en
title: "Analytics for Small Businesses: A Website Tracking Guide for Indonesian SMEs"
description: "An analytics guide for Indonesian small businesses: which metrics to watch, how to install tracking, and how to read the dashboard without GA4 pain."
ogDescription: "Which metrics small businesses should watch, how to install tracking, and how to read the dashboard."
published: 2026-05-16
updated: 2026-10-30
readMinutes: 9
category: guide
featured: false
related: [funnel-konversi, atribusi-pendapatan, analytics-tanpa-cookie]
draft: false
---

According to Indonesia's Ministry of Cooperatives and SMEs, the country has more than 64 million small and micro businesses. Most already have a website or an online shop. Ask the owner "Where do your website visitors come from?" or "Which product page is viewed most?" and a common answer is: *"No idea, the main thing is that we have a website."*

Without analytics you run the business blindfolded. You spend money on Instagram, Google Ads, or SEO without knowing which of them brings in buyers.

This guide is for small business owners who want to start using analytics without technical jargon and without becoming a data scientist.

## Why Do Small Businesses Need Analytics?

Take a made-up example: Ibu Sari runs an online shop selling hand-drawn batik from Solo. She promotes on Instagram, runs Google Ads, and has regular customers who order through WhatsApp.

Without analytics, none of these questions can be answered:

- How many people visited the website today?
- Where did they come from: Instagram, Google, or WhatsApp?
- Which batik is viewed the most?
- Did the ad she paid Rp 500.000 for yesterday actually bring visitors?
- How many visitors ended up filling in the order form?

With analytics, every one of those questions has an answer, and you can use the answer in a business decision right away.

> Analytics is not about data, it is about **decisions**. Every number you look at should translate into: "So, what should I do next?"

## The Problem with Google Analytics for Small Businesses

Most people install Google Analytics because it is free. For a small business, especially with GA4, a few things get in the way:

### 1. The dashboard is too complex

GA4 has many menus, many metrics, and confusing terms. For a shop owner who only wants to know "how many visitors today", it is overkill. Many open it once, get lost, and never return.

### 2. It takes time to learn

To use GA4 well you need to understand events, conversions, audiences, and exploration reports. That time is better spent running the business.

### 3. Raw data, not answers

GA4 shows raw data that you have to process yourself. "Pageviews are up 20%": up from where, and why? You have to dig that out on your own.

### 4. Privacy and consent

Google Analytics uses cookies and sends visitor data to Google. Under Indonesia's PDP Law (UU 27/2022), you as the site owner are the data controller: you need a lawful basis (consent is the safest) and a privacy notice that names the tools you use. That is extra work for a small business, and no tool you pick removes the obligation.

## The Metrics That Actually Matter for Small Businesses

You do not need to track dozens of metrics. Focus on these:

### 1. Pageviews

The total number of pages viewed by all visitors. It is the most basic metric and answers "is my website busy?". If pageviews are up from last week, there is more activity.

### 2. Visitors (unique visitors)

The number of individuals who visited your website. One visitor who opens 5 pages produces 5 pageviews but is still 1 visitor. This metric answers "how many people are interested in my business?".

### 3. Top pages

Which pages are visited most? For an online shop, usually the homepage, a few product pages, and the contact page. If product A is far more popular than product B, it may be time to prioritise stock for product A.

### 4. Traffic sources

Where do visitors come from? This metric ties directly to marketing budget decisions:

| Traffic source | What it means | What you can do |
|---|---|---|
| Direct | Visitors type your URL or use a bookmark | Your brand is known, usually returning customers. |
| Organic search | Visitors from Google (not ads) | SEO is working. Keep publishing useful content. |
| Social | Visitors from Instagram, TikTok, Facebook, and so on | Social media works. Post more on those platforms. |
| Referral | Visitors from a link on another website | Someone recommends you. Build the relationship. |
| Paid | Visitors from paid ads | Check whether the ad results justify the cost. |

### 5. Conversion rate

What percentage of visitors take the action you want? For a small business that could be filling in an order form, contacting you on WhatsApp, joining a newsletter, or completing a payment.

If 100 people visit the website and 5 fill in the order form, your conversion rate is 5%. You can keep improving that number.

> **A tip for small businesses**
>
> Do not fixate on absolute numbers. The **trend** is what matters: are there more visitors this week than last week, and is this month's conversion rate better than last month's? Small, consistent gains add up to growth.

## Installing RevKlik on a Small Business Website

Here is how to install analytics with RevKlik.

### Step 1: Create an account

Create a RevKlik account with an email and password. You can try the Growth plan for 7 days without a credit card.

### Step 2: Add your website

After logging in, click "Add Website" and enter your site's URL. You get a tracking script with the `data-site-id` for that site.

### Step 3: Put the script on your website

Copy the script into your website and place it before the `</head>` tag. For example:

```html
<script defer data-site-id="your-site-id" src="https://app.revklik.com/klikapa.js"></script>
```

**WordPress:** open Appearance → Theme File Editor → `header.php` and paste it before `</head>`. Or use a plugin such as "Insert Headers and Footers".

**Shopify and WooCommerce:** paste it into a theme file (for example `theme.liquid` on Shopify) or through your theme's header settings.

**Custom websites:** add it to the main template, before `</head>`.

### Step 4: Verify

Open your website in another browser (or an incognito window), visit a few pages, then check the RevKlik dashboard. Your visit should show up there.

### Step 5: Set up consent if needed

The RevKlik script is about 4 KB (gzip), so it is light to load. It stores a random visitor ID in the browser's local storage on your own domain (first-party, not a cookie). Because a persistent ID counts as personal data under the PDP Law, mention RevKlik in your privacy policy. If your audience includes Indonesian, EU, or UK residents, ask for consent before the tracker runs: add `data-consent="required"` to the script tag and call `klikapa.consent(true)` when the visitor accepts. The full guide is in the [documentation](https://docs.revklik.com/). This is not legal advice.

## How to Read the Dashboard

Once data starts coming in, here is how to read it as a business owner.

### Daily: check the visitor trend

Open the dashboard every morning (1-2 minutes) and look at the visitor chart. Up or down from yesterday? A sharp drop may mean a technical problem. A sharp rise is worth tracing: someone may have shared your link.

### Weekly: review traffic sources

Once a week, look at where visitors come from. If Instagram dominates, put your energy there. If organic search is growing, your SEO content is working. If paid traffic produces no conversions, consider stopping those ads.

### Monthly: review conversions and revenue

Every month, check your conversion rate. If your shop takes payments through Midtrans, Xendit, DOKU, Mayar, Paywuz, Polar, Stripe, or Lemon Squeezy, RevKlik can tie sales to the visit source with [revenue attribution](/en/blog/atribusi-pendapatan) (available from the Starter plan). That lets you compare marketing spend with the revenue each channel produced.

The dashboard windows are 7, 30, or 90 days, so write down important monthly numbers if you want to compare longer periods.

## Optimising Your Website with Data

Data without action is useless. A few ways to use it:

### 1. Polish your most popular pages

If one product page gets a lot of traffic, make sure it is in good shape: clear photos, a full description, a visible buy button, and a working WhatsApp link.

### 2. Check pages with a high bounce rate

A high bounce rate means visitors arrive and leave straight away. The cause may be a slow page, content that does not match expectations, or a design that does not inspire trust. Fix one thing at a time and watch the result.

### 3. Double down on the channel that works

If 60% of visitors come from Instagram, do not spend your time on Pinterest. Move effort to the channels that have proven themselves.

### 4. See how far visitors read

The [funnel](/en/blog/funnel-konversi) panel in RevKlik shows how far down a page visitors read. If many stop before the pricing or order section, start your fixes there.

### 5. Test changes and measure the result

Whenever you change something (button colour, call-to-action position, page layout), check the effect after 1-2 weeks. If the conversion rate goes up, keep the change. If it goes down, revert.

> **Do not get stuck on vanity metrics**
>
> High pageviews look good, but if nobody buys, the number means nothing. For a small business, 100 visitors with 10 buyers beats 10,000 visitors with none.

## GA4 and RevKlik for Small Businesses

| | Google Analytics 4 | RevKlik |
|---|---|---|
| Dashboard | Many menus and reports | One dashboard with the main panels |
| Tracks all channels | Yes | Yes |
| Revenue attribution | Needs a fairly involved setup | Built in, from the Starter plan |
| Cookies | Uses cookies | No third-party cookies, first-party visitor ID in local storage |
| Script size | Larger | About 4 KB (gzip) |
| Price | Free (data goes to Google) | From Rp 16.000/month |

## Start Today, Keep Going Tomorrow

Analytics is not something you install and forget, but it should not take hours either. A routine that is enough for a small business:

- **Morning:** open the dashboard and look at yesterday's visitor chart.
- **Friday:** check the weekly traffic sources and review your marketing channels.
- **End of month:** review conversion rate and revenue, then decide the focus for next month.

To learn how to track revenue from each marketing channel, read [revenue attribution](/en/blog/atribusi-pendapatan). To see where visitors stop, read [conversion funnels](/en/blog/funnel-konversi). For what the tracker collects, read [analytics without third-party cookies](/en/blog/analytics-tanpa-cookie).
