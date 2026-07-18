import { Hono } from "hono";
import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "shared";
import { sql } from "../db";
import { mapXenditMethod, timingSafeEqual } from "../lib/webhook-utils";
import { generateId } from "../utils";

export const xenditWebhookRoutes = new Hono<{
	Variables: { db: Kysely<KlikapaDatabase> };
}>();

// Subset of the Xendit webhook payload read by this handler. Xendit wraps the
// invoice in `data` for webhook events but also posts bare invoices.
interface XenditWebhookPayload {
	data?: XenditInvoice | null;
	event?: string;
	event_type?: string;
	metadata?: Record<string, string | undefined>;
	// bare-invoice fields (fallbacks used when `data` is absent)
	external_id?: string;
	amount?: number | null;
	currency?: string | null;
	payment_method?: string | null;
	payment_channel?: string | null;
	id?: string;
	recurring_payment_id?: string | null;
	status?: string;
	paid_at?: string | null;
}

interface XenditInvoice {
	id?: string;
	external_id?: string;
	amount?: number | null;
	currency?: string | null;
	payment_method?: string | null;
	payment_channel?: string | null;
	recurring_payment_id?: string | null;
	status?: string;
	paid_at?: string | null;
	metadata?: Record<string, string | undefined>;
}

function findIntegration(db: Kysely<KlikapaDatabase>, siteId: string) {
	return db
		.selectFrom("integrations")
		.select(["id", "site_id", "type", "config"])
		.where("site_id", "=", siteId)
		.where("type", "=", "xendit")
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

xenditWebhookRoutes.post("/", async (c) => {
	const db = c.get("db");
	const rawBody = await c.req.text();
	let body: XenditWebhookPayload;
	try {
		body = JSON.parse(rawBody) as XenditWebhookPayload;
	} catch {
		return c.json({ error: "Invalid JSON" }, 400);
	}

	const invoice: XenditInvoice = body.data || body;
	const metadata = invoice.metadata || body.metadata || {};
	const siteId = metadata.revklik_site_id || null;
	const externalId: string = invoice.external_id || body.external_id || "";
	if (!siteId && externalId.startsWith("revklik_")) {
		const parts = externalId.split("_");
		if (parts.length >= 3) {
			/* siteId = parts[1]; */
		}
	}
	if (!siteId) return c.json({ error: "Cannot resolve site_id" }, 400);

	const integration = await findIntegration(db, siteId);
	if (!integration) return c.json({ error: "No Xendit integration" }, 404);

	const config = JSON.parse((integration.config as string) || "{}");
	const webhookSecret = config.webhook_secret || "";
	const callbackToken = c.req.header("x-callback-token") || "";
	if (!webhookSecret || !timingSafeEqual(callbackToken, webhookSecret)) {
		await logWebhookEvent(
			db,
			siteId,
			integration.id,
			"xendit_invalid_token",
			rawBody,
			"failed",
		);
		return c.json({ error: "Invalid callback token" }, 401);
	}

	const eventType = body.event || body.event_type || "";
	if (eventType === "invoice.expired") {
		await logWebhookEvent(
			db,
			siteId,
			integration.id,
			"xendit_expired",
			rawBody,
			"processed",
		);
		return c.json({ success: true, action: "logged_expired" });
	}

	if (
		eventType === "invoice.paid" ||
		eventType === "recurring.cycle" ||
		invoice.status === "PAID"
	) {
		const amount = Number(invoice.amount ?? body.amount ?? 0);
		const currency = (invoice.currency ?? body.currency ?? "IDR").toUpperCase();
		const paymentMethod =
			invoice.payment_method ?? body.payment_method ?? "unknown";
		const paymentChannel =
			invoice.payment_channel ?? body.payment_channel ?? paymentMethod;
		const mappedMethod = mapXenditMethod(paymentMethod, paymentChannel);
		const xenditInvoiceId = invoice.id ?? body.id ?? externalId;
		const recurringId =
			invoice.recurring_payment_id ?? body.recurring_payment_id ?? null;
		const isRecurring = eventType === "recurring.cycle" || !!recurringId;

		const existing = await db
			.selectFrom("events")
			.select(["id"])
			.where("site_id", "=", siteId)
			.where(
				"event_type",
				"=",
				isRecurring ? "subscription" : "payment",
			)
			.where("props", "like", `%"xendit_invoice_id":"${xenditInvoiceId}"%`)
			.executeTakeFirst();
		if (existing) return c.json({ success: true, duplicate: true });

		const sessionId = metadata.revklik_session_id || generateId();
		let visitorId = metadata.revklik_visitor_id || null;
		if (!visitorId && sessionId) {
			const session = await db
				.selectFrom("sessions")
				.select(["visitor_id"])
				.where("id", "=", sessionId)
				.where("site_id", "=", siteId)
				.executeTakeFirst();
			if (session) visitorId = session.visitor_id;
		}
		if (!visitorId)
			visitorId = `xnd_${externalId.replace(/[^a-zA-Z0-9]/g, "_")}`;

		const ts = invoice.paid_at
			? new Date(invoice.paid_at).toISOString()
			: new Date().toISOString();
		const eventId = generateId();

		await db
			.insertInto("events")
			.values({
				id: eventId,
				site_id: siteId,
				session_id: sessionId,
				visitor_id: visitorId,
				timestamp: ts,
				event_type: isRecurring ? "subscription" : "payment",
				name: isRecurring
					? `subscription_${mappedMethod}`
					: `payment_${mappedMethod}`,
				path: "/payment",
				hostname: null,
				referrer: null,
				utm_source: metadata.revklik_utm_source || null,
				utm_medium: metadata.revklik_utm_medium || null,
				utm_campaign: metadata.revklik_utm_campaign || null,
				utm_term: null,
				utm_content: null,
				country: null,
				region: null,
				city: null,
				device_type: null,
				browser: null,
				os: null,
				revenue: amount,
				props: JSON.stringify({
					xendit_invoice_id: xenditInvoiceId,
					external_id: externalId,
					payment_channel: paymentChannel,
					source: "xendit_webhook",
					...(recurringId ? { recurring_payment_id: recurringId } : {}),
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
			`xendit_${eventType || "paid"}`,
			rawBody,
			"processed",
		);
		return c.json({
			success: true,
			event_id: eventId,
			amount,
			currency,
			method: mappedMethod,
		});
	}

	await logWebhookEvent(
		db,
		siteId,
		integration.id,
		`xendit_${eventType || "unknown"}`,
		rawBody,
		"processed",
	);
	return c.json({ success: true, action: "logged" });
});

xenditWebhookRoutes.get("/test", async (c) => {
	const db = c.get("db");
	const siteId = c.req.query("siteId");
	if (!siteId) return c.json({ error: "siteId required" }, 400);
	const logs = await db
		.selectFrom("webhook_events")
		.select(["id", "event_type", "status", "created_at", "processed_at"])
		.where("site_id", "=", siteId)
		.where("event_type", "like", "xendit_%")
		.orderBy("created_at", "desc")
		.limit(10)
		.execute();
	return c.json({ success: true, data: logs });
});
