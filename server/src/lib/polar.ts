import type { KlikapaDatabase } from "shared";
import type { Kysely } from "kysely";
import { generateId } from "../utils";
import { sql } from "../db";

/** Process a single Polar order — creates conversion event + upserts visitor profile. Deduplicates by visitor_id. */
export async function processPolarOrder(db: Kysely<KlikapaDatabase>, order: any, siteId: string): Promise<"imported" | "skipped" | "refunded"> {
  const polarOrderId = order.id;
  const visitorId = `polar_${polarOrderId.replace(/[^a-zA-Z0-9]/g, "_")}`;

  const existing = await db.selectFrom("events").select(["id", "revenue", "props"]).where("site_id", "=", siteId).where("visitor_id", "=", visitorId).executeTakeFirst();
  if (existing) {
    // If order was refunded, update existing event revenue to 0
    if (order.status === "refunded" && existing.revenue) {
      await db.updateTable("events").set({ revenue: 0, props: JSON.stringify({ ...(existing.props ? JSON.parse(existing.props as string) : {}), refunded: true }) }).where("id", "=", existing.id).execute();
      return "refunded";
    }
    return "skipped";
  }

  const isRefund = order.status === "refunded";
  const amount = isRefund ? 0 : (order.total_amount ?? 0) / 100;
  const country = order.customer?.billing_address?.country ?? order.billing_address?.country ?? null;
  const customerEmail = order.customer?.email ?? null;
  const customerName = order.customer?.name ?? order.billing_name ?? null;
  const ts = order.created_at ?? new Date().toISOString();
  const productName = order.product?.name ?? null;
  const billingReason = order.billing_reason ?? "purchase";
  const isRecurring = ["subscription_create", "subscription_cycle", "subscription_update"].includes(billingReason);

  await db.insertInto("events").values({
    id: generateId(), site_id: siteId, session_id: generateId(), visitor_id: visitorId,
    timestamp: ts, event_type: "conversion",
    name: isRecurring ? "subscription_payment" : "one_time_purchase",
    path: "/purchase", hostname: null, referrer: null,
    utm_source: null, utm_medium: null, utm_campaign: null, utm_term: null, utm_content: null,
    country, region: order.billing_address?.state ?? null, city: order.billing_address?.city ?? null,
    device_type: null, browser: null, os: null, revenue: amount,
    props: JSON.stringify({ polar_order_id: polarOrderId, currency: order.currency ?? "usd", customer_email: customerEmail, customer_name: customerName, product_name: productName, billing_reason: billingReason, source: "polar_sync" }),
    fingerprint: null,
  }).execute();

  await db.insertInto("visitor_profiles").values({
    id: generateId(), site_id: siteId, visitor_id: visitorId, name: customerName, email: customerEmail,
    first_seen: ts, last_seen: ts, country, region: order.billing_address?.state ?? null, city: order.billing_address?.city ?? null,
    device_type: null, browser: null, os: null, total_sessions: 0, total_pageviews: 0, total_revenue: amount, fingerprint: null,
  }).onConflict((oc) => oc.columns(["site_id", "visitor_id"]).doUpdateSet({
    last_seen: ts, total_revenue: sql`total_revenue + ${amount}`,
  })).execute();

  return "imported";
}
