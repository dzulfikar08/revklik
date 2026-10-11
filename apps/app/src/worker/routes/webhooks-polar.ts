import { Hono } from "hono";
import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { sql } from "../db";
import { verifyStandardWebhook } from "../lib/standard-webhooks";
import type { Env } from "../types";
import { generateId } from "../utils";

export const polarWebhookRoutes = new Hono<Env>();

// Subset of the Polar webhook payload read by this handler. Polar's JSON:API
// shape puts most fields under `data` (flat) or `data.attributes`.
interface PolarWebhookPayload {
	type?: string;
	event_type?: string;
	data?: PolarWebhookData | null;
}

interface PolarWebhookData {
	id?: string;
	metadata?: Record<string, string | undefined>;
	attributes?: PolarWebhookAttributes | null;
	// flat (top-level on data) variants of common fields
	amount?: number | string | null;
	currency?: string | null;
	customer_email?: string | null;
	created_at?: string | null;
	customer?: { email?: string | null } | null;
	product?: { name?: string | null } | null;
}

interface PolarWebhookAttributes {
	id?: string;
	metadata?: Record<string, string | undefined>;
	amount?: number | string | null;
	total?: number | string | null;
	net_amount?: number | string | null;
	currency?: string | null;
	customer_email?: string | null;
	product_name?: string | null;
	created_at?: string | null;
}

// Best-effort audit log. webhook_events.integration_id is NOT NULL, so only log when a polar
// integration row exists; the conversion itself is always recorded regardless.
async function findPolarIntegration(db: Kysely<KlikapaDatabase>, siteId: string) {
	return db
		.selectFrom("integrations")
		.select(["id", "config"])
		.where("site_id", "=", siteId)
		.where("type", "=", "polar")
		.where("enabled", "=", 1)
		.executeTakeFirst();
}

async function logWebhookEvent(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	integrationId: string | null,
	eventType: string,
	payload: string,
	status: string,
) {
	if (!integrationId) return; // no integration row -> skip audit (integration_id is NOT NULL)
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

polarWebhookRoutes.post("/", async (c) => {
	const db = c.get("db");
	const rawBody = await c.req.text();
	let body: PolarWebhookPayload;
	try {
		body = JSON.parse(rawBody) as PolarWebhookPayload;
	} catch {
		return c.json({ error: "Invalid JSON" }, 400);
	}

	const data: PolarWebhookData = body.data ?? {};
	const attributes: PolarWebhookAttributes = data.attributes ?? {};
	const metadata: Record<string, string | undefined> = {
		...(data.metadata ?? attributes.metadata),
	};

	// Resolve site_id: Polar checkout/product metadata -> query param.
	const siteId = metadata.revklik_site_id || c.req.query("site_id") || "";
	if (!siteId)
		return c.json(
			{
				error: "site_id required (set revklik_site_id in Polar metadata, or pass ?site_id=)",
			},
			400,
		);

	// Only the site's own Polar endpoint secret counts: RevKlik's billing secret
	// must never authenticate revenue into a customer's site.
	const integration = await findPolarIntegration(db, siteId);
	let secret = "";
	try {
		secret = JSON.parse(integration?.config || "{}").webhook_secret || "";
	} catch {
		/* malformed config: treated as missing */
	}
	if (!secret) {
		console.warn(`[webhooks-polar] site ${siteId}: no Polar integration webhook_secret, rejected`);
		return c.json({ error: "Polar webhook secret not configured for this site" }, 401);
	}
	const verdict = await verifyStandardWebhook(
		rawBody,
		{
			id: c.req.header("webhook-id") || "",
			timestamp: c.req.header("webhook-timestamp") || "",
			signature: c.req.header("webhook-signature") || "",
		},
		secret,
	);
	if (verdict !== "ok") {
		await logWebhookEvent(
			db,
			siteId,
			integration?.id ?? null,
			"polar_invalid_sig",
			rawBody,
			"failed",
		);
		return c.json(
			{ error: verdict === "stale" ? "Stale webhook timestamp" : "Invalid signature" },
			401,
		);
	}

	const type = body.type || body.event_type || ""; // e.g. "order.created"
	const orderId = data.id || attributes.id || "";
	const isSubscription = type === "subscription.created";

	// One-time products fire "order.created"; ignore the rest (refunds/cancellations handled separately if needed).
	if (type !== "order.created" && type !== "subscription.created") {
		await logWebhookEvent(
			db,
			siteId,
			integration?.id ?? null,
			`polar_${type}`,
			rawBody,
			"processed",
		);
		return c.json({ success: true, action: "logged" });
	}

	// Polar amounts are in cents. Handle both the flat (data.amount) and JSON:API (attributes.total) shapes.
	const rawAmount = Number(
		data.amount ?? attributes.amount ?? attributes.total ?? attributes.net_amount ?? 0,
	);
	const amount = rawAmount / 100;
	const currency = (data.currency || attributes.currency || "usd").toString().toUpperCase();
	const customerEmail =
		data.customer?.email || attributes.customer_email || data.customer_email || null;
	const productName =
		data.product?.name || attributes.product_name || metadata.product_name || "Polar purchase";

	// Dedupe by Polar order/subscription id in props.
	const dedupeKey = isSubscription ? "polar_subscription_id" : "polar_order_id";
	const existing = await db
		.selectFrom("events")
		.select(["id"])
		.where("site_id", "=", siteId)
		.where("event_type", "=", "conversion")
		.where(sql<string>`json_extract(props, ${`$.${dedupeKey}`})`, "=", String(orderId))
		.executeTakeFirst();
	if (existing) return c.json({ success: true, duplicate: true });

	const sessionId = metadata.revklik_session_id || generateId();
	let visitorId = metadata.revklik_visitor_id || null;
	if (sessionId) {
		const sessionRow = await db
			.selectFrom("sessions")
			.select(["visitor_id"])
			.where("id", "=", sessionId)
			.where("site_id", "=", siteId)
			.executeTakeFirst();
		if (sessionRow) visitorId = sessionRow.visitor_id;
	}
	if (!visitorId) visitorId = `polar_${String(orderId).replace(/[^a-zA-Z0-9]/g, "_")}`;

	const ts = data.created_at || attributes.created_at || new Date().toISOString();
	const eventId = generateId();

	await db
		.insertInto("events")
		.values({
			id: eventId,
			site_id: siteId,
			session_id: sessionId,
			visitor_id: visitorId,
			timestamp: ts,
			event_type: "conversion",
			name: isSubscription ? "subscription_polar" : "purchase_polar",
			path: "/checkout/success",
			hostname: null,
			referrer: null,
			utm_source: metadata.utm_source || null,
			utm_medium: metadata.utm_medium || null,
			utm_campaign: metadata.utm_campaign || null,
			utm_term: null,
			utm_content: null,
			country: null,
			region: null,
			city: null,
			device_type: null,
			browser: null,
			os: null,
			revenue: amount,
			payment_provider: "polar",
			currency,
			props: JSON.stringify({
				[dedupeKey]: orderId,
				product: productName,
				currency,
				source: "polar_webhook",
				...(customerEmail ? { email: customerEmail } : {}),
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
			name: null,
			email: customerEmail,
			phone: null,
			avatar: null,
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
			tags: null,
			notes: null,
		})
		.onConflict((oc) =>
			oc.columns(["site_id", "visitor_id"]).doUpdateSet({
				last_seen: ts,
				email: customerEmail ?? undefined,
				total_revenue: sql`total_revenue + ${amount}`,
			}),
		)
		.execute();

	await logWebhookEvent(db, siteId, integration?.id ?? null, `polar_${type}`, rawBody, "processed");
	return c.json({
		success: true,
		event_id: eventId,
		revenue: amount,
		currency,
		product: productName,
	});
});

polarWebhookRoutes.get("/test", async (c) => {
	const db = c.get("db");
	const siteId = c.req.query("siteId");
	if (!siteId) return c.json({ error: "siteId required" }, 400);
	const logs = await db
		.selectFrom("webhook_events")
		.select(["id", "event_type", "status", "created_at", "processed_at"])
		.where("site_id", "=", siteId)
		.where("event_type", "like", "polar_%")
		.orderBy("created_at", "desc")
		.limit(10)
		.execute();
	return c.json({ success: true, data: logs });
});
