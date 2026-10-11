import { Hono } from "hono";
import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { sql } from "../db";
import { mapStripePaymentMethod, verifyStripeSignature } from "../lib/webhook-utils";
import { generateId } from "../utils";

export const stripeWebhookRoutes = new Hono<{
	Variables: { db: Kysely<KlikapaDatabase> };
}>();

// Subset of the Stripe webhook event read by this handler.
interface StripeWebhookEvent {
	type?: string;
	data?: { object?: StripeCheckoutSession | null } | null;
}

interface StripeCheckoutSession {
	id?: string;
	metadata?: Record<string, string | undefined>;
	payment_intent?: string | null;
	amount_total?: number | null;
	amount_subtotal?: number | null;
	currency?: string | null;
	payment_method_types?: string[] | null;
	payment_settings?: { payment_method_types?: string[] | null } | null;
	subscription?: string | null;
	mode?: string | null;
}

function findIntegration(db: Kysely<KlikapaDatabase>, siteId: string) {
	return db
		.selectFrom("integrations")
		.select(["id", "site_id", "type", "config"])
		.where("site_id", "=", siteId)
		.where("type", "=", "stripe")
		.where("enabled", "=", 1)
		.executeTakeFirst();
}

async function logWebhookEvent(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	integrationId: string,
	eventType: string,
	payload: string,
	status: string,
) {
	await db
		.insertInto("webhook_events")
		.values({
			id: generateId(),
			site_id: siteId,
			integration_id: integrationId,
			direction: "inbound",
			event_type: eventType,
			payload,
			status,
			attempts: 1,
			created_at: new Date().toISOString(),
			processed_at: status === "processed" ? new Date().toISOString() : null,
		})
		.execute();
}

stripeWebhookRoutes.post("/", async (c) => {
	const db = c.get("db");
	const rawBody = await c.req.text();
	let event: StripeWebhookEvent;
	try {
		event = JSON.parse(rawBody) as StripeWebhookEvent;
	} catch {
		return c.json({ error: "Invalid JSON" }, 400);
	}

	const signatureHeader = c.req.header("Stripe-Signature") || "";
	if (!signatureHeader) return c.json({ error: "Missing Stripe-Signature header" }, 400);

	// Extract site_id from session metadata or query parameter
	const session = event.data?.object || {};
	const metadata = session.metadata || {};
	const siteId = metadata.revklik_site_id || c.req.query("site_id") || "";
	if (!siteId) return c.json({ error: "site_id required" }, 400);

	const integration = await findIntegration(db, siteId);
	if (!integration) return c.json({ error: "No Stripe integration" }, 404);

	const config = JSON.parse((integration.config as string) || "{}");
	const webhookSecret = config.webhook_secret || "";

	if (!webhookSecret) {
		await logWebhookEvent(db, siteId, integration.id, "stripe_no_secret", rawBody, "failed");
		return c.json({ error: "Webhook secret not configured for this integration" }, 401);
	}
	const valid = await verifyStripeSignature(rawBody, signatureHeader, webhookSecret);
	if (!valid) {
		await logWebhookEvent(db, siteId, integration.id, "stripe_invalid_sig", rawBody, "failed");
		return c.json({ error: "Invalid signature" }, 401);
	}

	const eventType = event.type || "";

	if (eventType !== "checkout.session.completed" && eventType !== "invoice.paid") {
		await logWebhookEvent(db, siteId, integration.id, `stripe_${eventType}`, rawBody, "processed");
		return c.json({ success: true, action: "logged" });
	}

	const sessionId = metadata.revklik_session_id || session.id || generateId();
	let visitorId = metadata.revklik_visitor_id || null;
	if (!visitorId && sessionId) {
		const sessionRow = await db
			.selectFrom("sessions")
			.select(["visitor_id"])
			.where("id", "=", sessionId)
			.where("site_id", "=", siteId)
			.executeTakeFirst();
		if (sessionRow) visitorId = sessionRow.visitor_id;
	}
	if (!visitorId) {
		const stripeSessionId = session.id || session.payment_intent || generateId();
		visitorId = `stripe_${stripeSessionId.replace(/[^a-zA-Z0-9]/g, "_")}`;
	}

	const amount = (session.amount_total ?? session.amount_subtotal ?? 0) / 100;
	const currency = (session.currency || "usd").toUpperCase();
	// Checkout sessions list payment_method_types; invoice.paid objects carry them
	// under payment_settings.
	const paymentMethodType =
		session.payment_method_types?.[0] ||
		session.payment_settings?.payment_method_types?.[0] ||
		"card";
	const mappedMethod = mapStripePaymentMethod(paymentMethodType);
	const stripeSessionId = session.id || "";

	const isSubscription =
		eventType === "invoice.paid" ||
		!!session.subscription ||
		(!!session.mode && session.mode === "subscription");
	const evtType = isSubscription ? "subscription" : "payment";

	// Deduplicate using stripe_session_id in props JSON
	const existing = await db
		.selectFrom("events")
		.select(["id"])
		.where("site_id", "=", siteId)
		.where("event_type", "=", evtType)
		.where("props", "like", `%"stripe_session_id":"${stripeSessionId}"%`)
		.executeTakeFirst();
	if (existing) return c.json({ success: true, duplicate: true });

	const ts = new Date().toISOString();
	const eventId = generateId();

	await db
		.insertInto("events")
		.values({
			id: eventId,
			site_id: siteId,
			session_id: sessionId,
			visitor_id: visitorId,
			timestamp: ts,
			event_type: evtType,
			name: isSubscription ? `subscription_${mappedMethod}` : `payment_${mappedMethod}`,
			path: "/checkout/success",
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
			revenue: amount,
			payment_provider: "stripe",
			payment_method: mappedMethod,
			currency,
			props: JSON.stringify({
				stripe_session_id: stripeSessionId,
				payment_method: mappedMethod,
				currency,
				source: "stripe_webhook",
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
			total_revenue: amount,
			fingerprint: null,
		})
		.onConflict((oc) =>
			oc.columns(["site_id", "visitor_id"]).doUpdateSet({
				last_seen: ts,
				total_revenue: sql`total_revenue + ${amount}`,
			}),
		)
		.execute();

	await logWebhookEvent(db, siteId, integration.id, `stripe_${eventType}`, rawBody, "processed");
	return c.json({
		success: true,
		event_id: eventId,
		revenue: amount,
		currency,
		method: mappedMethod,
	});
});

stripeWebhookRoutes.get("/test", async (c) => {
	const db = c.get("db");
	const siteId = c.req.query("siteId");
	if (!siteId) return c.json({ error: "siteId required" }, 400);
	const logs = await db
		.selectFrom("webhook_events")
		.select(["id", "event_type", "status", "created_at", "processed_at"])
		.where("site_id", "=", siteId)
		.where("event_type", "like", "stripe_%")
		.orderBy("created_at", "desc")
		.limit(10)
		.execute();
	return c.json({ success: true, data: logs });
});
