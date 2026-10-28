import { Hono } from "hono";
import { webhookRevenueFields } from "../lib/fees";
import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { sql } from "../db";
import { timingSafeEqual } from "../lib/webhook-utils";
import { generateId } from "../utils";

export const paywuzWebhookRoutes = new Hono<{
	Variables: { db: Kysely<KlikapaDatabase> };
}>();

// Paywuz (api.paywuz.id/v1, Bearer auth) posts webhooks when a transaction is
// paid. The payload shape is not guaranteed, so the handler extracts only the
// order id + site metadata and re-verifies everything else against the
// transaction detail API using the site's stored api_key (same trust model as
// pakasir: never credit revenue from an unverified webhook body).

interface PaywuzTransaction {
	orderId: string;
	transactionId?: string | null;
	status: string;
	amount: number;
	paymentMethod?: string | null;
	paidAt?: string | null;
}

interface PaywuzWebhookBody {
	metadata?: Record<string, string | undefined>;
	data?: (Record<string, unknown> & { metadata?: Record<string, string | undefined> }) | null;
	orderId?: string;
	order_id?: string;
	transaction_id?: string;
	payment_method?: string;
	status?: string;
	amount?: number;
}

interface ProviderRow {
	id: string;
	config: string | null;
}

function findProvider(db: Kysely<KlikapaDatabase>, siteId: string) {
	return db
		.selectFrom("payment_providers")
		.select(["id", "config"])
		.where("site_id", "=", siteId)
		.where("provider", "=", "paywuz")
		.where("enabled", "=", 1)
		.executeTakeFirst() as Promise<ProviderRow | undefined>;
}

async function logWebhookEvent(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	providerId: string,
	eventType: string,
	payload: string,
	status: string,
) {
	await db
		.insertInto("webhook_events")
		.values({
			id: generateId(),
			site_id: siteId,
			integration_id: providerId,
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

async function fetchTransaction(
	apiKey: string,
	orderId: string,
): Promise<PaywuzTransaction | null> {
	const res = await fetch(`https://api.paywuz.id/v1/transactions/${encodeURIComponent(orderId)}`, {
		headers: { Authorization: `Bearer ${apiKey}` },
	}).catch(() => null);
	if (!res || !res.ok) return null;
	const json = (await res.json().catch(() => null)) as { data?: PaywuzTransaction } | null;
	return json?.data ?? null;
}

const isPaidStatus = (status: string) =>
	["success", "paid", "settled"].includes(status.toLowerCase());

paywuzWebhookRoutes.post("/", async (c) => {
	const db = c.get("db");
	const rawBody = await c.req.text();
	let body: PaywuzWebhookBody;
	try {
		body = JSON.parse(rawBody) as PaywuzWebhookBody;
	} catch {
		return c.json({ error: "Invalid JSON" }, 400);
	}

	const metadata = body.metadata || body.data?.metadata || {};
	const siteId = metadata.revklik_site_id || null;
	const orderId = String(
		body.data?.orderId ?? body.orderId ?? body.order_id ?? body.transaction_id ?? "",
	);
	if (!siteId) return c.json({ error: "Cannot resolve site_id" }, 400);
	if (!orderId) return c.json({ error: "Cannot resolve order id" }, 400);

	const provider = await findProvider(db, siteId);
	if (!provider) return c.json({ error: "No Paywuz integration" }, 404);

	const config = JSON.parse((provider.config as string) || "{}") as Record<string, string>;
	const webhookSecret = config.webhook_secret || "";
	if (webhookSecret && !timingSafeEqual(c.req.header("x-webhook-token") || "", webhookSecret)) {
		await logWebhookEvent(db, siteId, provider.id, "paywuz_invalid_token", rawBody, "failed");
		return c.json({ error: "Invalid webhook token" }, 401);
	}

	// With an api_key the API response is the sole source of truth. With only
	// a webhook secret the provider-attested body is used (xendit/stripe model).
	const apiKey = config.api_key || "";
	const tx = apiKey ? await fetchTransaction(apiKey, orderId).catch(() => null) : null;
	if (apiKey && !tx) {
		await logWebhookEvent(db, siteId, provider.id, "paywuz_verify_failed", rawBody, "failed");
		return c.json({ error: "Verification failed" }, 401);
	}
	if (!apiKey && !webhookSecret) {
		return c.json({ error: "Provider not configured for verification" }, 401);
	}
	const status = String(tx?.status ?? body.data?.status ?? body.status ?? "");
	if (status && !isPaidStatus(status)) {
		await logWebhookEvent(db, siteId, provider.id, "paywuz_not_paid", rawBody, "processed");
		return c.json({ success: true, action: "logged_not_paid" });
	}
	const amount = Number(tx?.amount ?? body.data?.amount ?? body.amount ?? 0);
	if (!Number.isFinite(amount) || amount <= 0) {
		return c.json({ error: "Cannot resolve a positive amount" }, 422);
	}

	const existing = await db
		.selectFrom("events")
		.select(["id"])
		.where("site_id", "=", siteId)
		.where("event_type", "=", "payment")
		.where("props", "like", `%"paywuz_order_id":"${orderId}"%`)
		.executeTakeFirst();
	if (existing) return c.json({ success: true, duplicate: true });

	const sessionId = metadata.revklik_session_id || generateId();
	let visitorId = metadata.revklik_visitor_id || null;
	if (!visitorId) {
		const session = await db
			.selectFrom("sessions")
			.select(["visitor_id"])
			.where("id", "=", sessionId)
			.where("site_id", "=", siteId)
			.executeTakeFirst();
		if (session) visitorId = session.visitor_id;
	}
	if (!visitorId) visitorId = `pwy_${orderId.replace(/[^a-zA-Z0-9]/g, "_")}`;

	const ts = tx?.paidAt ? new Date(tx.paidAt).toISOString() : new Date().toISOString();
	const method = String(
		tx?.paymentMethod ?? body.data?.payment_method ?? body.payment_method ?? "unknown",
	).toLowerCase();
	const eventId = generateId();

	const revenueFields = await webhookRevenueFields(db, {
		siteId,
		rail: "paywuz",
		revenue: amount,
		currency: "IDR",
	});
	await db
		.insertInto("events")
		.values({
			id: eventId,
			site_id: siteId,
			session_id: sessionId,
			visitor_id: visitorId,
			timestamp: ts,
			event_type: "payment",
			name: `payment_${method}`,
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
			...revenueFields,
			payment_provider: "paywuz",
			payment_method: method,
			currency: "IDR",
			subscription_id: null,
			props: JSON.stringify({
				paywuz_order_id: orderId,
				transaction_id: tx?.transactionId ?? null,
				source: "paywuz_webhook",
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

	await logWebhookEvent(db, siteId, provider.id, "paywuz_paid", rawBody, "processed");
	return c.json({ success: true, event_id: eventId, amount, currency: "IDR", method });
});

paywuzWebhookRoutes.get("/test", async (c) => {
	const db = c.get("db");
	const siteId = c.req.query("siteId");
	if (!siteId) return c.json({ error: "siteId required" }, 400);
	const logs = await db
		.selectFrom("webhook_events")
		.select(["id", "event_type", "status", "created_at", "processed_at"])
		.where("site_id", "=", siteId)
		.where("event_type", "like", "paywuz_%")
		.orderBy("created_at", "desc")
		.limit(10)
		.execute();
	return c.json({ success: true, data: logs });
});
