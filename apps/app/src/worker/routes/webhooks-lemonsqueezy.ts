import { Hono } from "hono";
import { webhookRevenueFields } from "../lib/fees";
import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { sql } from "../db";
import { verifyLemonSqueezySignature } from "../lib/webhook-utils";
import { generateId } from "../utils";

export const lemonsqueezyWebhookRoutes = new Hono<{
	Variables: { db: Kysely<KlikapaDatabase> };
}>();

// Subset of the LemonSqueezy webhook payload read by this handler.
interface LemonSqueezyWebhookPayload {
	meta?: {
		event_name?: string;
		custom_data?: Record<string, string | undefined>;
	} | null;
	data?: {
		id?: string;
		attributes?: {
			total?: number | null;
			subtotal?: number | null;
			currency?: string | null;
		} | null;
	} | null;
}

function findIntegration(db: Kysely<KlikapaDatabase>, siteId: string) {
	return db
		.selectFrom("integrations")
		.select(["id", "site_id", "type", "config"])
		.where("site_id", "=", siteId)
		.where("type", "=", "lemonsqueezy")
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

lemonsqueezyWebhookRoutes.post("/", async (c) => {
	const db = c.get("db");
	const rawBody = await c.req.text();
	let body: LemonSqueezyWebhookPayload;
	try {
		body = JSON.parse(rawBody) as LemonSqueezyWebhookPayload;
	} catch {
		return c.json({ error: "Invalid JSON" }, 400);
	}

	// Resolve site_id from custom_data or query parameter
	const customData = body.meta?.custom_data || {};
	const siteId = customData.revklik_site_id || c.req.query("site_id") || "";
	if (!siteId) return c.json({ error: "site_id required" }, 400);

	const integration = await findIntegration(db, siteId);
	if (!integration) return c.json({ error: "No LemonSqueezy integration" }, 404);

	const config = JSON.parse((integration.config as string) || "{}");
	const webhookSecret = config.webhook_secret || "";
	const signatureHeader = c.req.header("x-signature") || "";

	if (!webhookSecret) {
		await logWebhookEvent(db, siteId, integration.id, "lemonsqueezy_no_secret", rawBody, "failed");
		return c.json({ error: "Webhook secret not configured for this integration" }, 401);
	}
	const signatureValid =
		!!signatureHeader &&
		(await verifyLemonSqueezySignature(rawBody, signatureHeader, webhookSecret));
	if (!signatureValid) {
		await logWebhookEvent(
			db,
			siteId,
			integration.id,
			"lemonsqueezy_invalid_sig",
			rawBody,
			"failed",
		);
		return c.json({ error: "Invalid signature" }, 401);
	}

	const eventName = body.meta?.event_name || "";
	const data = body.data || {};
	const attributes = data.attributes || {};
	const orderId = data.id || "";

	if (eventName !== "order_created" && eventName !== "subscription_created") {
		await logWebhookEvent(
			db,
			siteId,
			integration.id,
			`lemonsqueezy_${eventName}`,
			rawBody,
			"processed",
		);
		return c.json({ success: true, action: "logged" });
	}

	const amount = Number(attributes.total ?? attributes.subtotal ?? 0) / 100;
	const currency = (attributes.currency || "usd").toUpperCase();
	const isSubscription = eventName === "subscription_created";
	const evtType = isSubscription ? "subscription" : "payment";

	if (!orderId) return c.json({ error: "Missing order id" }, 400);

	// Exact-key dedupe: rows written before webhook_dedupe existed are matched on
	// the stored order id; new deliveries claim a key atomically.
	const legacy = await db
		.selectFrom("events")
		.select(["id"])
		.where("site_id", "=", siteId)
		.where("event_type", "=", evtType)
		.where(sql<string>`json_extract(props, '$.lemonsqueezy_order_id')`, "=", orderId)
		.executeTakeFirst();
	if (legacy) return c.json({ success: true, duplicate: true });
	const dedupeKey = `lemonsqueezy:${siteId}:${evtType}:${orderId}`;
	const claimed = await db
		.insertInto("webhook_dedupe")
		.values({ key: dedupeKey, created_at: new Date().toISOString() })
		.onConflict((oc) => oc.column("key").doNothing())
		.returning("key")
		.execute();
	if (claimed.length === 0) return c.json({ success: true, duplicate: true });

	const sessionId = customData.revklik_session_id || generateId();
	let visitorId = customData.revklik_visitor_id || null;
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
		visitorId = `lmsq_${orderId.replace(/[^a-zA-Z0-9]/g, "_")}`;
	}

	const ts = new Date().toISOString();
	const eventId = generateId();

	const revenueFields = await webhookRevenueFields(db, {
		siteId,
		rail: "lemonsqueezy",
		revenue: amount,
		currency,
	});
	await db
		.insertInto("events")
		.values({
			id: eventId,
			site_id: siteId,
			session_id: sessionId,
			visitor_id: visitorId,
			timestamp: ts,
			event_type: evtType,
			name: isSubscription ? "subscription_lemonsqueezy" : "payment_lemonsqueezy",
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
			...revenueFields,
			payment_provider: "lemonsqueezy",
			currency,
			props: JSON.stringify({
				lemonsqueezy_order_id: orderId,
				currency,
				source: "lemonsqueezy_webhook",
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

	await logWebhookEvent(
		db,
		siteId,
		integration.id,
		`lemonsqueezy_${eventName}`,
		rawBody,
		"processed",
	);
	return c.json({
		success: true,
		event_id: eventId,
		revenue: amount,
		currency,
	});
});

lemonsqueezyWebhookRoutes.get("/test", async (c) => {
	const db = c.get("db");
	const siteId = c.req.query("siteId");
	if (!siteId) return c.json({ error: "siteId required" }, 400);
	const logs = await db
		.selectFrom("webhook_events")
		.select(["id", "event_type", "status", "created_at", "processed_at"])
		.where("site_id", "=", siteId)
		.where("event_type", "like", "lemonsqueezy_%")
		.orderBy("created_at", "desc")
		.limit(10)
		.execute();
	return c.json({ success: true, data: logs });
});
