import { Hono } from "hono";
import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { sql } from "../db";
import { parseMidtransPaymentMethod, verifyMidtransSignature } from "../lib/webhook-utils";
import { generateId } from "../utils";

export const midtransWebhookRoutes = new Hono<{
	Variables: { db: Kysely<KlikapaDatabase> };
}>();

// Subset of the Midtrans notification payload read by this handler.
interface MidtransNotification {
	order_id?: string;
	status_code?: string;
	gross_amount?: string;
	signature_key?: string;
	transaction_status?: string;
	fraud_status?: string;
	payment_type?: string;
	transaction_time?: string;
	custom_field1?: string;
	custom_field2?: string;
	custom_field3?: string;
	custom_field4?: string;
}

// Provider config lives in payment_providers — the table the settings UI
// writes. (This route previously read the integrations table, which nothing
// populates for payment types.)
function findProvider(db: Kysely<KlikapaDatabase>, siteId: string) {
	return db
		.selectFrom("payment_providers")
		.select(["id", "config"])
		.where("site_id", "=", siteId)
		.where("provider", "=", "midtrans")
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

const _PAYMENT_TYPE_MAP: Record<string, string> = {
	gopay: "GoPay",
	qris: "QRIS",
	bank_transfer: "Bank Transfer",
	bca_va: "BCA VA",
	bni_va: "BNI VA",
	bri_va: "BRI VA",
	credit_card: "Credit Card",
	echannel: "Mandiri Bill",
	shopeepay: "ShopeePay",
	kredivo: "Kredivo",
	akulaku: "Akulaku",
	ovo: "OVO",
	dana: "DANA",
	linkaja: "LinkAja",
	cstore: "Convenience Store",
};

midtransWebhookRoutes.post("/", async (c) => {
	const db = c.get("db");
	const rawBody = await c.req.text();
	let notification: MidtransNotification;
	try {
		notification = JSON.parse(rawBody) as MidtransNotification;
	} catch {
		return c.json({ error: "Invalid JSON" }, 400);
	}

	const siteId = notification.custom_field4 || c.req.query("site_id") || "";
	if (!siteId) return c.json({ error: "site_id required" }, 400);

	const provider = await findProvider(db, siteId);
	if (!provider) return c.json({ error: "No Midtrans integration" }, 404);

	const config = JSON.parse((provider.config as string) || "{}");
	const serverKey = config.server_key || "";
	const orderId = notification.order_id || "";
	const statusCode = notification.status_code || "";
	const grossAmount = notification.gross_amount || "";
	const signatureKey = (notification.signature_key || "").toLowerCase();

	// Signature is mandatory: without it anyone could POST unverified revenue.
	// No server_key configured means the provider cannot be verified at all.
	if (!serverKey) {
		await logWebhookEvent(db, siteId, provider.id, "midtrans_unconfigured", rawBody, "failed");
		return c.json({ error: "Provider not configured for verification" }, 401);
	}
	if (!signatureKey) {
		await logWebhookEvent(db, siteId, provider.id, "midtrans_missing_sig", rawBody, "failed");
		return c.json({ error: "Missing signature" }, 401);
	}
	const valid = await verifyMidtransSignature(
		orderId,
		statusCode,
		grossAmount,
		serverKey,
		signatureKey,
	);
	if (!valid) {
		await logWebhookEvent(db, siteId, provider.id, "midtrans_invalid_sig", rawBody, "failed");
		return c.json({ error: "Invalid signature" }, 401);
	}

	const transactionStatus = notification.transaction_status || "";
	if (transactionStatus !== "settlement" && transactionStatus !== "capture") {
		await logWebhookEvent(
			db,
			siteId,
			provider.id,
			`midtrans_${transactionStatus}`,
			rawBody,
			"processed",
		);
		return c.json({ success: true, action: "logged" });
	}

	if (
		transactionStatus === "capture" &&
		notification.fraud_status &&
		notification.fraud_status !== "accept"
	) {
		await logWebhookEvent(
			db,
			siteId,
			provider.id,
			`midtrans_fraud_${notification.fraud_status}`,
			rawBody,
			"processed",
		);
		return c.json({ success: true, action: "fraud_rejected" });
	}

	const amount = parseFloat(grossAmount) || 0;
	const existing = await db
		.selectFrom("events")
		.select(["id"])
		.where("site_id", "=", siteId)
		.where("event_type", "=", "payment")
		.where("props", "like", `%"order_id":"${orderId}"%`)
		.executeTakeFirst();
	if (existing) return c.json({ success: true, action: "duplicate" });

	const sessionId = notification.custom_field1 || generateId();
	let visitorId = `midtrans_${orderId.replace(/[^a-zA-Z0-9]/g, "_")}`;
	if (notification.custom_field1) {
		const session = await db
			.selectFrom("sessions")
			.select(["visitor_id"])
			.where("id", "=", notification.custom_field1)
			.where("site_id", "=", siteId)
			.executeTakeFirst();
		if (session) visitorId = session.visitor_id;
	}

	const paymentType = notification.payment_type || "unknown";
	const mappedMethod = parseMidtransPaymentMethod(paymentType);
	const ts = notification.transaction_time
		? new Date(notification.transaction_time).toISOString()
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
			event_type: "payment",
			name: `payment_${paymentType}`,
			path: "/checkout/success",
			hostname: null,
			referrer: null,
			utm_source: notification.custom_field2 || null,
			utm_medium: null,
			utm_campaign: notification.custom_field3 || null,
			utm_term: null,
			utm_content: null,
			country: null,
			region: null,
			city: null,
			device_type: null,
			browser: null,
			os: null,
			revenue: amount,
			payment_provider: "midtrans",
			payment_method: mappedMethod,
			currency: "IDR",
			props: JSON.stringify({
				order_id: orderId,
				payment_type: paymentType,
				payment_method: mappedMethod,
				source: "midtrans_webhook",
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
		provider.id,
		`midtrans_${transactionStatus}`,
		rawBody,
		"processed",
	);
	return c.json({
		success: true,
		event_id: eventId,
		revenue: amount,
		method: mappedMethod,
	});
});

midtransWebhookRoutes.get("/test", async (c) => {
	const db = c.get("db");
	const siteId = c.req.query("siteId");
	if (!siteId) return c.json({ error: "siteId required" }, 400);
	const logs = await db
		.selectFrom("webhook_events")
		.select(["id", "event_type", "status", "created_at", "processed_at"])
		.where("site_id", "=", siteId)
		.where("event_type", "like", "midtrans_%")
		.orderBy("created_at", "desc")
		.limit(10)
		.execute();
	return c.json({ success: true, data: logs });
});
