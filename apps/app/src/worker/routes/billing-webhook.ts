import { Hono } from "hono";
import { createDb, sql } from "../db";
import { type PolarOrder, processPolarOrder } from "../lib/polar";
import type { Env } from "../types";
import { generateId } from "../utils";

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
	customer_id?: string;
	customer_email?: string | null;
	customer?: { email?: string | null } | null;
	// Order-only fields (delegated to processPolarOrder)
	total_amount?: number | null;
	currency?: string;
	created_at?: string;
	billing_name?: string | null;
	billing_reason?: string;
	billing_address?: {
		country?: string | null;
		state?: string | null;
		city?: string | null;
	} | null;
	product?: { name?: string | null } | null;
}

// POST / — Billing webhook (no auth — Polar calls this)
billingWebhookRoutes.post("/", async (c) => {
	const d1 = c.env.DB;
	if (!d1) return c.json({ error: "DB unavailable" }, 503);
	const db = createDb(d1);
	const body = await c.req.text();

	// Verify Polar webhook signature using standardwebhooks format
	const secret = c.env.POLAR_WEBHOOK_SECRET || "";
	if (secret) {
		const webhookId = c.req.header("webhook-id") || "";
		const webhookTs = c.req.header("webhook-timestamp") || "";
		const webhookSig = c.req.header("webhook-signature") || "";
		if (!webhookId || !webhookTs || !webhookSig) {
			return c.json({ error: "Missing webhook headers" }, 401);
		}
		// standardwebhooks: signed_payload = "${webhook_id}.${webhook_timestamp}.${body}"
		const signedPayload = `${webhookId}.${webhookTs}.${body}`;
		const enc = new TextEncoder();
		// Secret is base64-encoded (strip whsec_ prefix if present)
		const rawSecret = secret.startsWith("whsec_") ? secret.slice(7) : secret;
		const secretBytes = Uint8Array.from(atob(rawSecret), (c) =>
			c.charCodeAt(0),
		);
		const key = await crypto.subtle.importKey(
			"raw",
			secretBytes,
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["sign"],
		);
		const sig = await crypto.subtle.sign(
			"HMAC",
			key,
			enc.encode(signedPayload),
		);
		const computedSig = `v1,${btoa(String.fromCharCode(...new Uint8Array(sig)))}`;
		// Compare against any signature in the header (space-separated)
		const sigs = webhookSig.split(" ");
		let valid = false;
		for (const s of sigs) {
			let r = 0;
			const a = computedSig,
				b = s.startsWith("v1,") ? s : `v1,${s}`;
			const maxLen = Math.max(a.length, b.length);
			for (let i = 0; i < maxLen; i++)
				r |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
			if (r === 0) {
				valid = true;
				break;
			}
		}
		if (!valid) return c.json({ error: "Invalid signature" }, 401);
	}

	try {
		const event = JSON.parse(body) as PolarBillingEvent;
		// Polar webhook types: subscription.created, subscription.active, subscription.canceled, etc.
		const eventType = event.type;
		const data: PolarBillingData = event.data ?? {};
		// Metadata can be at top level (from checkout) or in data
		let userId = data?.metadata?.user_id || event.metadata?.user_id;
		const plan = data?.metadata?.plan || event.metadata?.plan;

		// Fallback: match user by customer email (direct checkout links have no metadata)
		if (!userId) {
			const customerEmail = data?.customer?.email || data?.customer_email;
			if (customerEmail) {
				const matched = await db
					.selectFrom("users")
					.select(["id"])
					.where("email", "=", customerEmail)
					.executeTakeFirst();
				if (matched) userId = matched.id;
			}
		}

		if (!userId) return c.json({ error: "Missing user_id" }, 400);

		if (
			eventType === "checkout.created" ||
			eventType === "subscription.created" ||
			eventType === "subscription.active" ||
			eventType === "subscription.updated"
		) {
			await db
				.insertInto("subscriptions")
				.values({
					id: generateId(),
					user_id: userId,
					plan: plan || "starter",
					status: data?.status || "active",
					current_period_start:
						data?.current_period_start || new Date().toISOString(),
					current_period_end:
						data?.current_period_end ||
						new Date(Date.now() + 30 * 86400000).toISOString(),
					cancel_at_period_end: 0,
					polar_subscription_id: data?.id || null,
					polar_customer_id: data?.customer_id || null,
					created_at: new Date().toISOString(),
					updated_at: new Date().toISOString(),
				})
				.onConflict((oc) =>
					oc.column("user_id").doUpdateSet({
						plan: plan || "starter",
						status: data?.status || "active",
						current_period_end: data?.current_period_end || undefined,
						polar_subscription_id: data?.id || undefined,
						polar_customer_id: data?.customer_id || undefined,
						updated_at: new Date().toISOString(),
					}),
				)
				.execute();

			// Revenue attribution: create conversion event from checkout metadata
			const visitorId = data?.metadata?.klikapa_visitor_id;
			const sessionId = data?.metadata?.klikapa_session_id;
			if (visitorId && plan && plan !== "free") {
				const userSites = await db
					.selectFrom("sites")
					.select(["id"])
					.where("user_id", "=", userId)
					.limit(1)
					.execute();
				const siteId = userSites[0]?.id;
				if (siteId) {
					const planPrice = plan === "growth" ? 12 : 4;
					const ts = new Date().toISOString();
					await db
						.insertInto("events")
						.values({
							id: generateId(),
							site_id: siteId,
							session_id: sessionId || generateId(),
							visitor_id: visitorId,
							timestamp: ts,
							event_type: "conversion",
							name: "subscription_payment",
							path: "/billing/checkout",
							hostname: null,
							referrer: null,
							utm_source: null,
							utm_medium: null,
							utm_campaign: null,
							utm_term: null,
							utm_content: null,
							country: null,
							region: null,
							city: null,
							device_type: null,
							browser: null,
							os: null,
							revenue: planPrice,
							props: JSON.stringify({
								plan,
								polar_subscription_id: data?.id,
								source: "polar_webhook",
							}),
							fingerprint: null,
						})
						.execute();
					await db
						.insertInto("visitor_profiles")
						.values({
							id: generateId(),
							site_id: siteId,
							visitor_id: visitorId,
							first_seen: ts,
							last_seen: ts,
							country: null,
							region: null,
							city: null,
							device_type: null,
							browser: null,
							os: null,
							total_sessions: 0,
							total_pageviews: 0,
							total_revenue: planPrice,
							fingerprint: null,
						})
						.onConflict((oc) =>
							oc.columns(["site_id", "visitor_id"]).doUpdateSet({
								last_seen: ts,
								total_revenue: sql`total_revenue + ${planPrice}`,
							}),
						)
						.execute();
				}
			}
		} else if (eventType === "order.paid" || eventType === "order.refunded") {
			// Order events — process using shared helper
			const order = data;
			const customerEmail = order?.customer?.email || order?.customer_email;
			let orderUserId = order?.metadata?.user_id || userId;

			// Resolve user from customer email if no user_id
			if (!orderUserId && customerEmail) {
				const matched = await db
					.selectFrom("users")
					.select(["id"])
					.where("email", "=", customerEmail)
					.executeTakeFirst();
				if (matched) orderUserId = matched.id;
			}
			if (!orderUserId)
				return c.json({ error: "Cannot resolve user for order" }, 400);

			// Find user's first site to attribute revenue
			const userSites = await db
				.selectFrom("sites")
				.select(["id"])
				.where("user_id", "=", orderUserId)
				.limit(1)
				.execute();
			const siteId = userSites[0]?.id;
			if (!siteId) return c.json({ error: "No site found for user" }, 404);

			const result = await processPolarOrder(db, order as PolarOrder, siteId);
			return c.json({ success: true, result });
		} else if (eventType === "subscription.canceled") {
			await db
				.updateTable("subscriptions")
				.set({
					cancel_at_period_end: 1,
					status: "canceled",
					updated_at: new Date().toISOString(),
				})
				.where("user_id", "=", userId)
				.execute();
		}
		return c.json({ success: true });
	} catch (err) {
		return c.json(
			{ error: err instanceof Error ? err.message : "Webhook error" },
			500,
		);
	}
});
