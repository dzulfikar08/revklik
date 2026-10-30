import { Hono } from "hono";
import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import {
	type PolarBooking,
	type PolarOrder,
	bookPolarOrder,
	isBookablePolarOrder,
} from "../lib/polar";
import { findPolarProvider } from "../lib/polar-sync";
import { notifySaleEvent, pushCtx } from "../lib/push";
import { verifyStandardWebhook } from "../lib/standard-webhooks";
import { logRejectedDelivery } from "../lib/webhook-log";
import type { Env } from "../types";
import { generateId } from "../utils";

export const polarWebhookRoutes = new Hono<Env>();

// Subset of the Polar webhook payload read by this handler. Real Polar events put
// the Order flat under `data`; the legacy JSON:API shape nests fields under
// `data.attributes`, and the console relay sends a flat `amount`.
interface PolarWebhookPayload {
	type?: string;
	/** When Polar created the event: for order.refunded, the moment of the refund. */
	timestamp?: string | null;
	event_type?: string;
	data?: PolarWebhookData | null;
}

type Cents = number | string | null | undefined;

interface PolarWebhookData {
	id?: string;
	metadata?: Record<string, unknown> | null;
	attributes?: PolarWebhookAttributes | null;
	status?: string | null;
	paid?: boolean | null;
	billing_reason?: string | null;
	amount?: Cents;
	net_amount?: Cents;
	total_amount?: Cents;
	refunded_amount?: Cents;
	platform_fee_amount?: Cents;
	platform_fee_currency?: string | null;
	currency?: string | null;
	customer_email?: string | null;
	created_at?: string | null;
	modified_at?: string | null;
	billing_name?: string | null;
	billing_address?: { country?: string | null } | null;
	customer?: {
		email?: string | null;
		name?: string | null;
		billing_address?: { country?: string | null } | null;
	} | null;
	product?: { name?: string | null } | null;
}

interface PolarWebhookAttributes {
	id?: string;
	status?: string | null;
	refunded_amount?: Cents;
	metadata?: Record<string, unknown> | null;
	amount?: Cents;
	total?: Cents;
	net_amount?: Cents;
	platform_fee_amount?: Cents;
	platform_fee_currency?: string | null;
	currency?: string | null;
	customer_email?: string | null;
	product_name?: string | null;
	created_at?: string | null;
}

const SERVER_ERROR_BODY = { error: "Could not record the order, Polar will retry" };

function toCents(value: Cents): number | null {
	if (value === null || value === undefined || value === "") return null;
	const n = Number(value);
	return Number.isFinite(n) ? n : null;
}

/** Checkout metadata with every value as a string (Polar also allows numbers and booleans). */
function stringMetadata(raw: Record<string, unknown> | null | undefined): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(raw ?? {})) {
		if (value !== null && value !== undefined) out[key] = String(value);
	}
	return out;
}

/** The booking input for a delivery, whichever payload shape it used. */
function orderFromWebhook(
	type: string,
	data: PolarWebhookData,
	attributes: PolarWebhookAttributes,
	metadata: Record<string, string>,
	eventAt: string | null | undefined,
): PolarOrder {
	// net_amount is after discounts and before tax; the console relay calls it `amount`.
	const net = toCents(data.amount ?? attributes.amount ?? data.net_amount ?? attributes.net_amount);
	const refunded = toCents(data.refunded_amount ?? attributes.refunded_amount);
	return {
		id: String(data.id || attributes.id || ""),
		status: data.status ?? attributes.status ?? undefined,
		paid: data.paid,
		net_amount: net,
		total_amount: toCents(data.total_amount ?? attributes.total),
		// An order.refunded that does not say how much refunds the whole order.
		refunded_amount: type === "order.refunded" ? (refunded ?? net) : refunded,
		platform_fee_amount: toCents(data.platform_fee_amount ?? attributes.platform_fee_amount),
		platform_fee_currency: data.platform_fee_currency ?? attributes.platform_fee_currency,
		currency: data.currency || attributes.currency || "usd",
		created_at: data.created_at || attributes.created_at || undefined,
		modified_at: data.modified_at,
		// The event time is the refund time; the order's own modified_at is the next best.
		refunded_at: type === "order.refunded" ? (eventAt ?? data.modified_at) : undefined,
		billing_name: data.billing_name,
		billing_reason: data.billing_reason ?? undefined,
		billing_address: data.billing_address,
		customer: {
			email: data.customer?.email || attributes.customer_email || data.customer_email || null,
			name: data.customer?.name,
			billing_address: data.customer?.billing_address,
		},
		product: {
			name:
				data.product?.name || attributes.product_name || metadata.product_name || "Polar purchase",
		},
		metadata,
	};
}

async function logWebhookEvent(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	integrationId: string | null,
	eventType: string,
	payload: string,
	status: string,
) {
	// webhook_events.integration_id is NOT NULL: a site with no Polar row keeps no audit trail.
	if (!integrationId) return;
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
	const metadata = stringMetadata(data.metadata ?? attributes.metadata);

	// The endpoint URL names the site (and so the secret); checkout metadata is the fallback.
	const siteId = c.req.query("site_id") || metadata.revklik_site_id || "";
	if (!siteId)
		return c.json(
			{
				error:
					"site_id required (add ?site_id= to the webhook URL, or set revklik_site_id in checkout metadata)",
			},
			400,
		);

	// Only the site's own Polar endpoint secret counts: RevKlik's billing secret
	// must never authenticate revenue into a customer's site.
	const provider = await findPolarProvider(db, siteId);
	const secret = provider?.enabled ? provider.config.webhook_secret || "" : "";
	if (!provider || !secret) {
		console.warn(`[webhooks-polar] site ${siteId}: no Polar webhook secret, rejected`);
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
		await logRejectedDelivery(db, siteId, provider.id, "polar_invalid_sig", verdict);
		const error =
			verdict === "stale"
				? "Stale webhook timestamp"
				: verdict === "missing_headers"
					? "Missing Standard Webhooks headers"
					: "Invalid signature";
		return c.json({ error }, 401);
	}

	const type = body.type || body.event_type || ""; // e.g. "order.paid"
	const log = (status: string) =>
		logWebhookEvent(db, siteId, provider.id, `polar_${type}`, rawBody, status);

	// Revenue comes from orders only. A subscription's first payment and every
	// renewal arrive as orders too (billing_reason subscription_create and
	// subscription_cycle), so counting subscription events would book each twice.
	const isRefund = type === "order.refunded";
	if (type !== "order.created" && type !== "order.paid" && !isRefund) {
		await log("processed");
		return c.json({ success: true, action: "logged" });
	}

	const order = orderFromWebhook(type, data, attributes, metadata, body.timestamp);
	// order.created can precede payment (pending invoices); order.paid follows and counts it.
	// A payload without a status is the console's relay of an already-paid order.
	if (type === "order.created" && !isBookablePolarOrder(order) && data.paid !== true) {
		await log("processed");
		return c.json({ success: true, action: "pending" });
	}
	if (!order.id) return c.json({ error: "order id required" }, 400);

	let booking: PolarBooking;
	try {
		booking = await bookPolarOrder(db, order, siteId, c.env);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[webhooks-polar] site ${siteId} order ${order.id}: ${message}`);
		await log("failed");
		// A number the ledger cannot hold will never succeed; anything else is worth a retry.
		return err instanceof RangeError
			? c.json({ error: message }, 422)
			: c.json(SERVER_ERROR_BODY, 500);
	}
	if (!booking.sale) {
		const site = await db
			.selectFrom("sites")
			.select("id")
			.where("id", "=", siteId)
			.executeTakeFirst();
		if (!site) return c.json({ error: "Unknown site_id" }, 404);
		await log("processed");
		return c.json({ success: true, action: "ignored" });
	}

	const ctx = pushCtx(c);
	if (!booking.sale.duplicate) {
		notifySaleEvent(c.env, ctx, { id: booking.sale.eventId, siteId });
	}
	if (booking.refund !== "none" && booking.refundEventId) {
		notifySaleEvent(c.env, ctx, { id: booking.refundEventId, siteId });
	}
	await log("processed");

	const booked = !booking.sale.duplicate || booking.refund !== "none";
	return c.json({
		success: true,
		...(booked ? {} : { duplicate: true }),
		event_id: booking.sale.eventId,
		refund: booking.refund,
		currency: (order.currency ?? "usd").toUpperCase(),
		product: order.product?.name,
	});
});
