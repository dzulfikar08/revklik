# Payment webhooks

Every provider webhook runs the same pipeline (`apps/app/src/worker/lib/payments/pipeline.ts`): find the site's enabled `payment_providers` row, verify the delivery with that row's secret, parse it into sale/refund legs, book each leg idempotently through `recordServerEvent`. A provider adapter (`lib/payments/adapters/*.ts`) only supplies `siteId`, `verify` and `parse`.

- **Idempotency**: `events.external_id = "<provider>:<provider transaction id>"`, unique per site. Refunds are `<key>:refund` (one per sale), `<key>~<refund id>:refund` (provider sends a refund id) or `<key>~<already refunded>:refund` (provider reports the running refunded total; the difference is booked). No claim row exists, so a failed delivery leaves nothing behind.
- **Failures**: any error after verification answers 5xx (503 when the provider's API is unreachable), so the provider retries; a retry can only complete the work.
- **Test mode**: Stripe `livemode:false`, LemonSqueezy `test_mode`, Midtrans `SB-` server key (or Production Mode off), `environment: sandbox` on DOKU/Xendit/Mayar/Paywuz config. Stored with `excluded_reason = 'test'`, never counted.
- **Money**: amounts are major units; Stripe minor units use the currency's own exponent. Sales and refunds are gross (tax included), so a refund reverses exactly what the sale booked.
- **FX**: each event stores `fx_rate` (units of its currency per USD), `fx_date` and `fx_status` (`live`, `fallback`, `unconverted`) when booked. Converted totals use that rate; a currency with no rate stays in its native amount, is flagged `unconverted` and is left out of converted totals.

| Provider | Sale | Renewal | Refund | Site resolved from |
| --- | --- | --- | --- | --- |
| Stripe | `checkout.session.completed` (paid), `invoice.paid` | `invoice.paid` | `charge.refunded` (running total) | metadata `revklik_site_id`, `?site_id=`, or the booked sale |
| LemonSqueezy | `order_created` (paid) | `subscription_payment_success` | `order_refunded`, `subscription_payment_refunded` (running total) | `custom_data.revklik_site_id`, `?site_id=`, or the booked sale |
| Midtrans | `settlement`, accepted `capture` | none | `refund`, `partial_refund` (running total), `chargeback` | `custom_field4`, `?site_id=`, or the booked order |
| Xendit | invoice PAID/SETTLED | `recurring.cycle.succeeded` | `refund.succeeded` (own id) | metadata, `?site_id=`, or the booked invoice |
| DOKU | SNAP VA payment | none | none (no refund notification on this channel) | `X-PARTNER-ID` = saved client id |
| Mayar | status settled/paid/success | when the transaction has a subscription | status `refunded` | metadata |
| Paywuz | status success/paid/settled | none | status `refunded` | metadata |
| Pakasir | RevKlik's own billing (`/webhooks/pakasir`), not customer revenue | none | none | n/a |

Mayar and Paywuz require `webhook_secret` (header `x-webhook-token`); with an `api_key` they also re-read the transaction from the provider.
