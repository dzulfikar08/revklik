import { Hono } from "hono";
import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { notifySaleEvent, pushCtx } from "../lib/push";
import { polarReportedNet } from "../lib/polar";
import { recordServerEvent } from "../lib/server-events";
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
	status?: string | null;
	paid?: boolean | null;
	billing_reason?: string | null;
	// flat (top-level on data) variants of common fields
	amount?: number | string | null;
	net_amount?: number | string | null;
	total_amount?: number | string | null;
	refunded_amount?: number | string | null;
	platform_fee_amount?: number | string | null;
	platform_fee_currency?: string | null;
	currency?: string | null;
	customer_email?: string | null;
	created_at?: string | null;
	customer?: { email?: string | null } | null;
	product?: { name?: string | null } | null;
}

interface PolarWebhookAttributes {
	id?: string;
	status?: string | null;
	refunded_amount?: number | string | null;
	metadata?: Record<string, string | undefined>;
	amount?: number | string | null;
	total?: number | string | null;
	net_amount?: number | string | null;
	platform_fee_amount?: number | string | null;
	platform_fee_currency?: string | null;
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
	const orderId = String(data.id || attributes.id || "");

	// Revenue comes from orders only. A subscription's first payment arrives as an
	// order too (billing_reason subscription_create), so counting subscription.created
	// as well would book every new subscriber twice.
	const isRefund = type === "order.refunded";
	if (type !== "order.created" && type !== "order.paid" && !isRefund) {
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
	// order.created can precede payment (pending invoices); order.paid follows and counts it.
	// A payload without a status is the console's relay of an already-paid order.
	const status = data.status ?? attributes.status;
	if (type === "order.created" && status && status !== "paid" && data.paid !== true) {
		await logWebhookEvent(
			db,
			siteId,
			integration?.id ?? null,
			`polar_${type}`,
			rawBody,
			"processed",
		);
		return c.json({ success: true, action: "pending" });
	}
	if (!orderId) return c.json({ error: "order id required" }, 400);

	// Polar amounts are cents. Real orders carry net_amount (after discounts, before
	// tax) and total_amount; the console relay sends a flat `amount`; the legacy
	// JSON:API shape nests them under attributes.
	const rawAmount = Number(
		(isRefund ? (data.refunded_amount ?? attributes.refunded_amount) : null) ??
			data.amount ??
			attributes.amount ??
			data.net_amount ??
			attributes.net_amount ??
			data.total_amount ??
			attributes.total ??
			0,
	);
	const amount = (Number.isFinite(rawAmount) ? rawAmount : 0) / 100;
	const currency = (data.currency || attributes.currency || "usd").toString().toUpperCase();
	// Polar's own fee is real proceeds data; without it the fee rule estimates the net.
	const rawFee = data.platform_fee_amount ?? attributes.platform_fee_amount;
	const reportedNet =
		isRefund || rawFee === null || rawFee === undefined
			? null
			: polarReportedNet(
					rawAmount,
					Number(rawFee),
					currency,
					data.platform_fee_currency ?? attributes.platform_fee_currency,
				);
	const customerEmail =
		data.customer?.email || attributes.customer_email || data.customer_email || null;
	const productName =
		data.product?.name || attributes.product_name || metadata.product_name || "Polar purchase";

	const site = await db
		.selectFrom("sites")
		.select(["id", "revenue_currency"])
		.where("id", "=", siteId)
		.executeTakeFirst();
	if (!site) return c.json({ error: "Unknown site_id" }, 404);

	// The idempotency key is the order id, shared with the server events API, so an
	// order seen through both paths (or twice through this one) books once.
	const result = await recordServerEvent(
		db,
		site,
		{
			siteId,
			name: isRefund ? "refund" : "purchase_polar",
			revenue: isRefund ? -amount : amount,
			currency,
			externalId: isRefund ? `${orderId}:refund` : orderId,
			source: "polar",
			rail: "polar",
			props: {
				polar_order_id: orderId,
				product: productName,
				billing_reason: data.billing_reason,
				...(customerEmail ? { email: customerEmail } : {}),
			},
			occurredAt: data.created_at || attributes.created_at || null,
			netRevenue: reportedNet,
			visitorId: metadata.revklik_visitor_id || null,
			sessionId: metadata.revklik_session_id || null,
			utmSource: metadata.utm_source || null,
			utmMedium: metadata.utm_medium || null,
			utmCampaign: metadata.utm_campaign || null,
		},
		c.env,
	);
	if (result.duplicate) return c.json({ success: true, duplicate: true });
	notifySaleEvent(c.env, pushCtx(c), { id: result.eventId, siteId });

	if (customerEmail) {
		await db
			.updateTable("visitor_profiles")
			.set({ email: customerEmail })
			.where("site_id", "=", siteId)
			.where("visitor_id", "=", result.visitorId)
			.execute();
	}

	await logWebhookEvent(db, siteId, integration?.id ?? null, `polar_${type}`, rawBody, "processed");
	return c.json({
		success: true,
		event_id: result.eventId,
		revenue: isRefund ? -amount : amount,
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
