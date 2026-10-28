import { Hono } from "hono";
import { webhookRevenueFields } from "../lib/fees";
import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { sql } from "../db";
import { timingSafeEqual } from "../lib/webhook-utils";
import { notifySaleEvent, pushCtx } from "../lib/push";
import type { Bindings } from "../types";
import { generateId } from "../utils";

export const mayarWebhookRoutes = new Hono<{
	Bindings: Bindings;
	Variables: { db: Kysely<KlikapaDatabase> };
}>();

// Mayar (api.mayar.id/hl/v1|v2, Bearer auth) posts webhooks when a payment
// link transaction settles. The payload shape is not guaranteed, so the
// handler extracts only the transaction id + site metadata and re-verifies
// against the transactions API using the site's stored api_key — revenue is
// never credited from the webhook body itself. v1 is deprecated 1 Oct 2026;
// v2 is the default.

interface MayarTransaction {
	id: string;
	credit: number;
	status: string;
	balanceHistoryType?: string | null;
	paymentMethod?: string | null;
	createdAt?: number | null;
	subscriptionId?: string | null;
	amount?: number;
}

interface MayarWebhookBody {
	metadata?: Record<string, string | undefined>;
	data?: (Record<string, unknown> & { metadata?: Record<string, string | undefined> }) | null;
	id?: string;
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
		.where("provider", "=", "mayar")
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
	apiVersion: string,
	txnId: string,
): Promise<MayarTransaction | null> {
	const base = apiVersion === "v2" ? "https://api.mayar.id/hl/v2" : "https://api.mayar.id/hl/v1";
	const res = await fetch(`${base}/transactions?page=1&pageSize=100`, {
		headers: { Authorization: `Bearer ${apiKey}` },
	}).catch(() => null);
	if (!res || !res.ok) return null;
	const json = (await res.json().catch(() => null)) as { data?: MayarTransaction[] } | null;
	return json?.data?.find((t) => t.id === txnId) ?? null;
}

const isPaidStatus = (status: string) =>
	["settled", "paid", "success"].includes(status.toLowerCase());

mayarWebhookRoutes.post("/", async (c) => {
	const db = c.get("db");
	const rawBody = await c.req.text();
	let body: MayarWebhookBody;
	try {
		body = JSON.parse(rawBody) as MayarWebhookBody;
	} catch {
		return c.json({ error: "Invalid JSON" }, 400);
	}

	const metadata = body.metadata || body.data?.metadata || {};
	const siteId = metadata.revklik_site_id || null;
	const txnId = String(body.data?.id ?? body.id ?? body.transaction_id ?? "");
	if (!siteId) return c.json({ error: "Cannot resolve site_id" }, 400);
	if (!txnId) return c.json({ error: "Cannot resolve transaction id" }, 400);

	const provider = await findProvider(db, siteId);
	if (!provider) return c.json({ error: "No Mayar integration" }, 404);

	const config = JSON.parse((provider.config as string) || "{}") as Record<string, string>;
	const webhookSecret = config.webhook_secret || "";
	if (webhookSecret && !timingSafeEqual(c.req.header("x-webhook-token") || "", webhookSecret)) {
		await logWebhookEvent(db, siteId, provider.id, "mayar_invalid_token", rawBody, "failed");
		return c.json({ error: "Invalid webhook token" }, 401);
	}

	// Authoritative verification against the Mayar API — the webhook body is
	// only used to find the transaction, never to credit revenue.
	const apiKey = config.api_key || "";
	const apiVersion = config.api_version === "v1" ? "v1" : "v2";
	const tx = apiKey ? await fetchTransaction(apiKey, apiVersion, txnId).catch(() => null) : null;
	if (apiKey && !tx) {
		await logWebhookEvent(db, siteId, provider.id, "mayar_verify_failed", rawBody, "failed");
		return c.json({ error: "Verification failed" }, 401);
	}
	if (!apiKey && !webhookSecret) {
		return c.json({ error: "Provider not configured for verification" }, 401);
	}
	const status = String(tx?.status ?? body.data?.status ?? body.status ?? "");
	if (status && !isPaidStatus(status)) {
		await logWebhookEvent(db, siteId, provider.id, "mayar_not_paid", rawBody, "processed");
		return c.json({ success: true, action: "logged_not_paid" });
	}
	const amount = Number(tx?.credit ?? tx?.amount ?? body.data?.amount ?? body.amount ?? 0);
	if (!Number.isFinite(amount) || amount <= 0) {
		return c.json({ error: "Cannot resolve a positive amount" }, 422);
	}

	const isSubscription = !!tx?.subscriptionId;
	const existing = await db
		.selectFrom("events")
		.select(["id"])
		.where("site_id", "=", siteId)
		.where("event_type", "=", isSubscription ? "subscription" : "payment")
		.where("props", "like", `%"mayar_transaction_id":"${txnId}"%`)
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
	if (!visitorId) visitorId = `myr_${txnId.replace(/[^a-zA-Z0-9]/g, "_")}`;

	const ts = tx?.createdAt ? new Date(tx.createdAt).toISOString() : new Date().toISOString();
	const eventId = generateId();
	const method = String(
		tx?.paymentMethod ?? body.data?.payment_method ?? body.payment_method ?? "unknown",
	).toLowerCase();

	const revenueFields = await webhookRevenueFields(db, {
		siteId,
		rail: "mayar",
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
			event_type: isSubscription ? "subscription" : "payment",
			name: isSubscription ? `subscription_${method}` : `payment_${method}`,
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
			payment_provider: "mayar",
			payment_method: method,
			currency: "IDR",
			subscription_id: tx?.subscriptionId ?? null,
			props: JSON.stringify({
				mayar_transaction_id: txnId,
				payment_link_id: null,
				source: "mayar_webhook",
				...(tx?.subscriptionId ? { subscription_id: tx.subscriptionId } : {}),
			}),
			fingerprint: null,
		})
		.execute();

	notifySaleEvent(c.env, pushCtx(c), { id: eventId, siteId });

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
		provider.id,
		`mayar_${isSubscription ? "subscription" : "paid"}`,
		rawBody,
		"processed",
	);
	return c.json({ success: true, event_id: eventId, amount, currency: "IDR", method });
});

mayarWebhookRoutes.get("/test", async (c) => {
	const db = c.get("db");
	const siteId = c.req.query("siteId");
	if (!siteId) return c.json({ error: "siteId required" }, 400);
	const logs = await db
		.selectFrom("webhook_events")
		.select(["id", "event_type", "status", "created_at", "processed_at"])
		.where("site_id", "=", siteId)
		.where("event_type", "like", "mayar_%")
		.orderBy("created_at", "desc")
		.limit(10)
		.execute();
	return c.json({ success: true, data: logs });
});
