import { Hono } from "hono";
import { webhookRevenueFields } from "../lib/fees";
import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { sql } from "../db";
import { verifyDokuSignature } from "../lib/webhook-utils";
import { generateId } from "../utils";

export const dokuWebhookRoutes = new Hono<{
	Variables: { db: Kysely<KlikapaDatabase> };
}>();

// DOKU SNAP payment notification (developers.doku.com — "HTTP Notification
// Sample for SNAP"). Headers: X-TIMESTAMP, X-SIGNATURE, X-PARTNER-ID (DOKU's
// client id), Authorization (Bearer access token). X-SIGNATURE = HMAC-SHA512
// (clientSecret, `POST:RELATIVE-URL:ACCESS-TOKEN:HEX(SHA256(body)):TIMESTAMP`).
// The site is resolved from X-PARTNER-ID against the stored client_id, so the
// payload itself is only used after the signature checks out.

interface DokuWebhookBody {
	responseCode?: string;
	responseMessage?: string;
	virtualAccountData?: {
		trxId?: string;
		virtualAccountNo?: string;
		virtualAccountName?: string;
		paymentFlag?: string;
		trxDateTime?: string;
		amount?: { value?: string; currency?: string };
		[key: string]: unknown;
	};
}

interface ProviderRow {
	id: string;
	site_id: string;
	config: string | null;
}

async function findProviderByClientId(
	db: Kysely<KlikapaDatabase>,
	clientId: string,
): Promise<ProviderRow | undefined> {
	const rows = (await db
		.selectFrom("payment_providers")
		.select(["id", "site_id", "config"])
		.where("provider", "=", "doku")
		.where("enabled", "=", 1)
		.execute()) as Array<ProviderRow>;
	return rows.find((r) => {
		try {
			return (
				(JSON.parse((r.config as string) || "{}") as Record<string, string>).client_id === clientId
			);
		} catch {
			return false;
		}
	});
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

dokuWebhookRoutes.post("/", async (c) => {
	const db = c.get("db");
	const rawBody = await c.req.text();
	let body: DokuWebhookBody;
	try {
		body = JSON.parse(rawBody) as DokuWebhookBody;
	} catch {
		return c.json({ error: "Invalid JSON" }, 400);
	}

	const clientId = c.req.header("x-partner-id") || "";
	if (!clientId) return c.json({ error: "X-PARTNER-ID required" }, 400);

	const provider = await findProviderByClientId(db, clientId);
	if (!provider) return c.json({ error: "No DOKU integration" }, 404);
	const siteId = provider.site_id;

	const config = JSON.parse((provider.config as string) || "{}") as Record<string, string>;
	const clientSecret = config.secret_key || "";
	if (!clientSecret) {
		await logWebhookEvent(db, siteId, provider.id, "doku_unconfigured", rawBody, "failed");
		return c.json({ error: "Provider not configured for verification" }, 401);
	}

	const valid = await verifyDokuSignature({
		httpMethod: "POST",
		relativeUrl: new URL(c.req.url).pathname,
		authorizationHeader: c.req.header("authorization") || "",
		requestBody: rawBody,
		timestamp: c.req.header("x-timestamp") || "",
		clientSecret,
		signature: c.req.header("x-signature") || "",
	});
	if (!valid) {
		await logWebhookEvent(db, siteId, provider.id, "doku_invalid_signature", rawBody, "failed");
		return c.json({ error: "Invalid signature" }, 401);
	}

	// SNAP VA payment notifications are only sent for paid transactions.
	const va = body.virtualAccountData ?? {};
	const trxId = String(va.trxId ?? va.virtualAccountNo ?? "");
	const amount = Number(va.amount?.value ?? 0);
	if (!trxId || !Number.isFinite(amount) || amount <= 0) {
		await logWebhookEvent(db, siteId, provider.id, "doku_unparseable", rawBody, "failed");
		return c.json({ error: "Cannot resolve transaction" }, 422);
	}

	const existing = await db
		.selectFrom("events")
		.select(["id"])
		.where("site_id", "=", siteId)
		.where("event_type", "=", "payment")
		.where("props", "like", `%"doku_trx_id":"${trxId}"%`)
		.executeTakeFirst();
	if (existing) return c.json({ success: true, duplicate: true });

	// DOKU callbacks carry no klikapa session metadata (site is resolved via
	// the client_id) — attribute to a deterministic synthetic visitor.
	const visitorId = `dku_${trxId.replace(/[^a-zA-Z0-9]/g, "_")}`;
	const sessionId = generateId();
	const ts = va.trxDateTime ? new Date(va.trxDateTime).toISOString() : new Date().toISOString();
	const eventId = generateId();
	const currency = (va.amount?.currency || "IDR").toUpperCase();

	const revenueFields = await webhookRevenueFields(db, {
		siteId,
		rail: "doku",
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
			event_type: "payment",
			name: "payment_doku",
			path: "/payment",
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
			payment_provider: "doku",
			payment_method: "va",
			currency,
			subscription_id: null,
			props: JSON.stringify({
				doku_trx_id: trxId,
				virtual_account_no: va.virtualAccountNo ?? null,
				source: "doku_webhook",
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

	await logWebhookEvent(db, siteId, provider.id, "doku_paid", rawBody, "processed");
	return c.json({ success: true, event_id: eventId, amount, currency });
});

dokuWebhookRoutes.get("/test", async (c) => {
	const db = c.get("db");
	const siteId = c.req.query("siteId");
	if (!siteId) return c.json({ error: "siteId required" }, 400);
	const logs = await db
		.selectFrom("webhook_events")
		.select(["id", "event_type", "status", "created_at", "processed_at"])
		.where("site_id", "=", siteId)
		.where("event_type", "like", "doku_%")
		.orderBy("created_at", "desc")
		.limit(10)
		.execute();
	return c.json({ success: true, data: logs });
});
