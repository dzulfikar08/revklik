---
lang: en
title: "How to Track Revenue from Shopee, Tokopedia, and Your Own Website"
description: "A guide to cross-channel revenue tracking: Shopee, Tokopedia, and your own website. How to attribute marketplace sales and combine the data in one dashboard."
published: 2026-05-16
updated: 2026-10-30
readMinutes: 8
category: revenue
featured: false
related: [atribusi-pendapatan, funnel-konversi, analytics-tanpa-cookie]
draft: true
---

The average Indonesian seller operates on **3-5 channels at once**: Shopee, Tokopedia, maybe TikTok Shop, Instagram DMs, and their own website. Every channel has its own analytics dashboard. The question: can you answer, in 30 seconds, which channel is the most profitable this month?

If the answer is "not sure", you are not alone. Almost every Indonesian seller struggles to combine revenue data from multiple marketplaces. They know total turnover, but not the *profit per channel* after ad costs, marketplace commissions, and shipping.

This article covers how to build a centralized cross-channel [revenue attribution](/en/blog/atribusi-pendapatan) system, from Shopee and Tokopedia to your own website, using modern analytics.

## Why Is Multi-Channel So Hard?

Every marketplace is a closed ecosystem. Shopee has its Shopee Ads dashboard. Tokopedia has its Tokopedia Ads dashboard. Your own website probably uses Google Analytics. Each gives you different data, with different metrics, in different formats.

The main problems:

- **Fragmented data**: Shopee revenue is in the Shopee dashboard, Tokopedia revenue is in the Tokopedia dashboard. There is no unified view.
- **Inconsistent metrics**: Shopee counts an "order" differently from Tokopedia. One counts GMV (Gross Merchandise Value), the other net revenue after deductions.
- **No cross-channel user journey**: A customer can view a product on Tokopedia but buy on Shopee because of a voucher. No marketplace tracks this.
- **Hidden costs**: Marketplace commissions (1-8%), internal ad costs, subsidized shipping. All of them eat into your margin, but they do not always show up in the revenue dashboard.

> If you cannot measure profit per channel accurately, you may be wasting money on a channel that looks busy but actually loses money.

## The Problem with Marketplace Built-In Analytics

Shopee and Tokopedia each provide their own analytics dashboard. But there are serious limitations that sellers often overlook:

### Shopee Analytics

The Shopee dashboard shows only what happens *inside Shopee*. You can see total sales, best-selling products, and ad performance. But:

- No tracking of customers who come to Shopee from social media
- No direct comparison with other channels
- Limited data export: it cannot be integrated directly into a BI tool
- Short attribution window: orders are only linked to ads from the last 7 days

### Tokopedia Analytics

Tokopedia gives similar insights for its own ecosystem. The limitations are alike:

- Analysis is limited to visitors who have already transacted on Tokopedia
- No tracking from awareness (TikTok/IG content) to purchase
- Traffic and conversion metrics cannot be compared directly with Shopee

The bottom line: marketplace analytics are useful for optimizing *inside that platform*. But for strategic decisions, such as which channel should get more budget, you need data combined from all sources.

## How to Track Revenue on Your Own Website

Before the marketplaces, let us start with the channel you control the most: your own website. Tracking revenue on your website is easier because you have full access to the data.

The basic steps:

### 1. Install the Analytics Script

Add the analytics script to every page of your website. With RevKlik, it is one line:

`<script defer data-site-id="..." src="https://app.revklik.com/klikapa.js"></script>`

This script is about 4 KB (gzip) and loads without blocking the page. Every pageview, click, and navigation is recorded automatically.

### 2. Track Conversion Events

Every time a payment happens, send a `purchase` event to analytics. You can do this through:

- **Payment webhook**: Your payment processor (Xendit, Midtrans, Polar) automatically sends a notification to RevKlik when a payment succeeds
- **Custom event**: Call the RevKlik API from the "Thank You" page after checkout

The data to send: payment amount, product, and visitor identification (email or visitor ID).

### 3. Connect with UTM

Every marketing link that points to your website should have UTM parameters. When a visitor lands, the UTM is stored in the session. When they pay, the revenue is automatically linked to the traffic source.

Learn more about connecting UTM with revenue in our [revenue attribution](/en/blog/atribusi-pendapatan) guide.

## Marketplace Integration via Webhook

This is the part people ask about most: **how do you connect sales data from Shopee and Tokopedia to your website analytics?**

The answer: **webhook APIs**.

### How Marketplace Webhooks Work

Shopee and Tokopedia both provide APIs that send an automatic notification whenever an important event happens, including new orders, completed orders, and payments received.

The flow:

1. A customer pays on Shopee/Tokopedia
2. The marketplace sends an HTTP POST to your webhook URL (example: `https://app.revklik.com/api/webhook/shopee`)
3. RevKlik receives the data: order ID, amount, product, status
4. The revenue is recorded in the dashboard, tagged as the "Shopee" or "Tokopedia" channel
5. The data is combined with revenue from your website and other channels

**Important Tip**

Use the "order completed" event, not "order placed". Many marketplace orders are cancelled or returned. Tracking revenue when the order is completed gives you more accurate numbers.

### Shopee Open Platform API

Shopee provides an Open Platform API that developers can access. The main endpoints for revenue tracking:

- `order/list`: List of orders with date and status filters
- `order/detail`: Order details including items, amounts, and payment
- `payment/list`: Payment data that has been settled

To set up the webhook, register an app on Shopee Open Platform, get an API key, and configure the endpoint in the RevKlik dashboard.

### Tokopedia API

Tokopedia (now part of GoTo) provides a similar API through the Tokopedia Developer Platform:

- `order/single`: Notification per new order
- `order/batch`: Fetch a batch of orders by time range
- `finance/account`: Settlement and balance data

Same as Shopee: register an app, get credentials, and connect it to the RevKlik webhook.

## Tracking Comparison Table by Channel

| Aspect | Own Website | Shopee | Tokopedia |
|---|---|---|---|
| Data Control | Full | Limited (API) | Limited (API) |
| UTM Tracking | Yes, complete | Not available | Not available |
| User Journey | Full funnel | In-platform only | In-platform only |
| Revenue Tracking | Real-time via webhook | After settlement (1-3 days) | After settlement (1-3 days) |
| Transaction Fees | 0% (direct payment) | 2-8% commission | 1-5% commission |
| Custom Events | Yes, unlimited | No | No |
| A/B Testing | Yes | No | No |
| Customer Ownership | 100% yours | Owned by the marketplace | Owned by the marketplace |

## Step-by-Step Setup Guide

Here are the practical steps to build a cross-channel revenue tracking system:

### Step 1: Connect Your Website to RevKlik

Add the RevKlik script to your website. It takes less than 2 minutes. Once installed, all traffic and conversions are recorded automatically.

### Step 2: Configure the Payment Webhook

Connect your website's payment processor (Xendit, Midtrans, or Polar) to RevKlik. Every successful payment is recorded immediately as a revenue event.

### Step 3: Connect Shopee via API

1. Register on **Shopee Open Platform** (open.shopee.com)
2. Create an app and get your Partner Key + Shop ID
3. In the RevKlik dashboard, open Integrations and choose "Shopee"
4. Enter your credentials and enable the webhook for the `order_completed` event
5. Verify by placing a test order

### Step 4: Connect Tokopedia via API

1. Register on **Tokopedia Developer** (developer.tokopedia.com)
2. Create an app and get your Client ID + Client Secret
3. In the RevKlik dashboard, open Integrations and choose "Tokopedia"
4. Enter your credentials and enable the webhook
5. Verify the connection with a test order

### Step 5: View the Unified Dashboard

Once all channels are connected, the RevKlik dashboard shows revenue from all sources in one view. You can:

- Compare revenue per channel (Shopee vs Tokopedia vs Website)
- View the [conversion funnel](/en/blog/funnel-konversi) for each channel
- Identify which channel is the most profitable after costs
- Track weekly or monthly revenue trends per channel

**Calculate Profit, Not Revenue**

Do not look only at GMV (Gross Merchandise Value). Shopee revenue of Rp 10 million does not mean Rp 10 million in profit. Subtract marketplace commissions, internal ad costs, and shipping. In the RevKlik dashboard, you can add a **cost per channel** so you see net profit, not gross turnover.

## Strategies for Optimizing Multi-Channel

With centralized revenue data, you can make strategic decisions:

### Allocate Budget Based on Profit

Do not split your ad budget evenly across all channels. Use attribution data to allocate more to the channel with the highest profit per visitor. Example: if your own website earns Rp 50.000 profit per visitor while Shopee earns only Rp 15.000, invest more in SEO and content for the website.

### Use Marketplaces as an Acquisition Channel

Marketplaces are very good for finding new customers. But the margin is thin. A smart strategy: use marketplaces for acquisition, then move loyal customers to your own website for repeat purchases at a higher margin.

### Track Cross-Channel Behavior

Customers often view a product on one channel and buy on another. This is called **cross-channel attribution**. Example: someone sees a product review on TikTok, checks the price on Shopee, but ends up buying directly on your website because it is cheaper. Without a centralized system, you will never know that the TikTok content started that journey.

## FAQ

### How do I track revenue from Shopee and Tokopedia at the same time?

Use the webhook APIs from Shopee and Tokopedia, which send an automatic notification whenever an order is completed. Connect these webhooks to an analytics platform such as RevKlik, which records revenue per channel automatically. Data from all marketplaces and your own website can be combined in one centralized dashboard.

### Are the built-in analytics from Shopee and Tokopedia enough?

Not for strategic cross-channel decisions. Marketplace built-in analytics only show data inside each platform. You cannot compare Shopee vs Tokopedia vs your website in one view, there is no cross-channel attribution, and no complete user journey tracking from first visit to purchase.

### Do I need visitor consent to track marketplace revenue?

Tracking through marketplace webhook APIs runs server to server and does not use browser cookies. For the tracker on your own website, RevKlik uses a random first-party visitor ID in the browser's local storage, with no third-party cookies. A persistent ID counts as personal data under Indonesia's PDP Law, and you are the data controller. Mention RevKlik in your privacy policy and ask for consent before the tracker runs (`data-consent="required"`) if your visitors include Indonesian, EU or UK residents.

### How much does cross-channel revenue tracking cost with RevKlik?

RevKlik starts at **Rp 16.000/month** for 10,000 events. It includes website tracking, marketplace webhook integration, revenue attribution, and a centralized dashboard. Much more affordable than enterprise analytics tools that cost hundreds of dollars per month.
