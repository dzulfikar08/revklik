import { Hono } from "hono";
import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { createDb, sql } from "../db";
import { recordReferralCommission } from "../lib/affiliates";
import { convertAmount, usdRates } from "../lib/fx";
import type { Env } from "../types";
import { PLANS, type PlanTier } from "../lib/plans";
import { verifyStandardWebhook } from "../lib/standard-webhooks";
import { generateId, normalizeEmail } from "../utils";

export const billingWebhookRoutes = new Hono<Env>();

// Subset of the Polar billing webhook event read by this handler.
interface PolarBillingEvent {
	type?: string;
	metadata?: Record<string, string | undefined>;
	data?: PolarBillingData | null;
}

interface PolarBillingData {
	id?: string;
	status?: string;
	metadata?: Record<string, string | undefined>;
	current_period_start?: string;
	current_period_end?: string;
	cancel_at_period_end?: boolean;
	total_amount?: number | null;
	currency?: string;
	product_id?: string;
	customer_id?: string;
	customer_email?: string | null;
	customer?: { email?: string | null } | null;
	product?: { id?: string; name?: string | null } | null;
}

const SUBSCRIPTION_UPSERT_EVENTS = new Set([
	"subscription.created",
	"subscription.active",
	"subscription.updated",
]);
const HANDLED_EVENTS = new Set([
	...SUBSCRIPTION_UPSERT_EVENTS,
	"subscription.canceled",
	"subscription.revoked",
	"order.paid",
]);

/** Plan from checkout metadata, else from the Polar product id configured per tier. */
function resolvePlan(
	data: PolarBillingData,
	eventMetadata: Record<string, string | undefined> | undefined,
	env: Env["Bindings"],
): PlanTier | null {
	const fromMeta = data.metadata?.plan || eventMetadata?.plan;
	if (fromMeta && fromMeta in PLANS) return fromMeta as PlanTier;
	const productId = data.product_id || data.product?.id;
	if (!productId) return null;
	if (productId === env.POLAR_GROWTH_PRODUCT_ID) return "growth";
	if (productId === env.POLAR_STARTER_PRODUCT_ID) return "starter";
	if (productId === env.POLAR_MICRO_PRODUCT_ID) return "micro";
	return null;
}

async function markProcessed(db: Kysely<KlikapaDatabase>, key: string): Promise<void> {
	await db
		.insertInto("webhook_dedupe")
		.values({ key, created_at: new Date().toISOString() })
		.onConflict((oc) => oc.column("key").doNothing())
		.execute();
}

// POST / — Billing webhook (no auth — Polar calls this)
billingWebhookRoutes.post("/", async (c) => {
	const d1 = c.env.DB;
	if (!d1) return c.json({ error: "DB unavailable" }, 503);
	const db = createDb(d1);
	const body = await c.req.text();

	// Fail closed: without the secret any caller could grant itself a plan.
	const secret = c.env.POLAR_WEBHOOK_SECRET || "";
	if (!secret) return c.json({ error: "POLAR_WEBHOOK_SECRET not configured" }, 503);
	const webhookId = c.req.header("webhook-id") || "";
	const verdict = await verifyStandardWebhook(
		body,
		{
			id: webhookId,
			timestamp: c.req.header("webhook-timestamp") || "",
			signature: c.req.header("webhook-signature") || "",
		},
		secret,
	);
	if (verdict === "missing_headers") return c.json({ error: "Missing webhook headers" }, 401);
	if (verdict === "stale") return c.json({ error: "Stale webhook timestamp" }, 401);
	if (verdict !== "ok") return c.json({ error: "Invalid signature" }, 401);

	const dedupeKey = `polar-billing:${webhookId}`;
	const replay = await db
		.selectFrom("webhook_dedupe")
		.select("key")
		.where("key", "=", dedupeKey)
		.executeTakeFirst();
	if (replay) return c.json({ success: true, duplicate: true });

	try {
		const event = JSON.parse(body) as PolarBillingEvent;
		// Polar webhook types: subscription.created, subscription.active, subscription.canceled, etc.
		const eventType = event.type ?? "";
		if (!HANDLED_EVENTS.has(eventType)) return c.json({ success: true, ignored: eventType });
		const data: PolarBillingData = event.data ?? {};
		// Metadata can be at top level (from checkout) or in data
		let userId = data?.metadata?.user_id || event.metadata?.user_id;
		const plan = resolvePlan(data, event.metadata, c.env);

		// Fallback: match user by customer email (direct checkout links have no metadata)
		if (!userId) {
			const customerEmail = data?.customer?.email || data?.customer_email;
			if (customerEmail) {
				const matched = await db
					.selectFrom("users")
					.select(["id"])
					.where(sql<string>`lower(email)`, "=", normalizeEmail(customerEmail))
					.executeTakeFirst();
				if (matched) userId = matched.id;
			}
		}

		if (!userId) return c.json({ error: "Missing user_id" }, 400);

		// checkout.created is deliberately absent: it fires before payment and its
		// data.id / status describe the checkout, not a subscription.
		if (SUBSCRIPTION_UPSERT_EVENTS.has(eventType)) {
			const cancelAtPeriodEnd =
				data.cancel_at_period_end === undefined ? undefined : data.cancel_at_period_end ? 1 : 0;
			await db
				.insertInto("subscriptions")
				.values({
					id: generateId(),
					user_id: userId,
					plan: plan || "starter",
					status: data?.status || "active",
					current_period_start: data?.current_period_start || new Date().toISOString(),
					current_period_end:
						data?.current_period_end || new Date(Date.now() + 30 * 86400000).toISOString(),
					cancel_at_period_end: cancelAtPeriodEnd ?? 0,
					polar_subscription_id: data?.id || null,
					polar_customer_id: data?.customer_id || null,
					created_at: new Date().toISOString(),
					updated_at: new Date().toISOString(),
				})
				.onConflict((oc) =>
					oc.column("user_id").doUpdateSet({
						// Without a resolvable plan keep the stored one rather than guess.
						plan: plan || undefined,
						status: data?.status || "active",
						current_period_start: data?.current_period_start || undefined,
						current_period_end: data?.current_period_end || undefined,
						cancel_at_period_end: cancelAtPeriodEnd,
						polar_subscription_id: data?.id || undefined,
						polar_customer_id: data?.customer_id || undefined,
						updated_at: new Date().toISOString(),
					}),
				)
				.execute();
		} else if (eventType === "order.paid") {
			// RevKlik's own sales are not the customer's revenue: they are never
			// written into the paying customer's site analytics. They do pay the
			// referring affiliate, keyed on the order id.
			const amount = (data.total_amount ?? 0) / 100;
			const amountUsd = convertAmount(amount, data.currency ?? "USD", "USD", usdRates(c.env));
			if (data.id) await recordReferralCommission(db, userId, `polar:${data.id}`, amountUsd);
		} else if (eventType === "subscription.canceled") {
			// Cancellation is scheduled: access runs to current_period_end.
			await db
				.updateTable("subscriptions")
				.set({
					cancel_at_period_end: 1,
					current_period_end: data?.current_period_end || undefined,
					updated_at: new Date().toISOString(),
				})
				.where("user_id", "=", userId)
				.execute();
		} else if (eventType === "subscription.revoked") {
			// Revocation ends access now (period over, refund, or immediate cancel).
			const now = new Date().toISOString();
			await db
				.updateTable("subscriptions")
				.set({
					status: "canceled",
					cancel_at_period_end: 0,
					current_period_end: now,
					updated_at: now,
				})
				.where("user_id", "=", userId)
				.execute();
		}
		await markProcessed(db, dedupeKey);
		return c.json({ success: true });
	} catch (err) {
		return c.json({ error: err instanceof Error ? err.message : "Webhook error" }, 500);
	}
});
