import { Hono } from "hono";
import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { generateId } from "../utils";

export const webhookRoutes = new Hono<{
	Variables: { db: Kysely<KlikapaDatabase> };
}>();

function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let result = 0;
	for (let i = 0; i < a.length; i++) {
		result |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return result === 0;
}

async function validateHmac(body: string, secret: string, signature: string): Promise<boolean> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
	const computed = btoa(String.fromCharCode(...new Uint8Array(sig)));
	return timingSafeEqual(computed, signature);
}

/** A webhook body as an object: JSON, or Mailchimp's form encoding (`data[email]=…`). Null when neither. */
function parseWebhookBody(raw: string, contentType: string | undefined): Record<string, unknown> | null {
	if (contentType?.includes("application/x-www-form-urlencoded")) {
		const parsed: Record<string, unknown> = {};
		const data: Record<string, string> = {};
		for (const [key, value] of new URLSearchParams(raw)) {
			const nested = /^data\[(.+)\]$/.exec(key);
			if (nested?.[1]) data[nested[1]] = value;
			else parsed[key] = value;
		}
		return { ...parsed, data };
	}
	try {
		const json: unknown = JSON.parse(raw);
		return json && typeof json === "object" && !Array.isArray(json)
			? (json as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

async function findIntegration(db: Kysely<KlikapaDatabase>, siteId: string, type: string) {
	return db
		.selectFrom("integrations")
		.select(["id", "site_id", "type", "config"])
		.where("site_id", "=", siteId)
		.where("type", "=", type)
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

async function processWebhookEvent(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	email: string,
	eventType: string,
) {
	const visitor = await db
		.selectFrom("visitor_profiles")
		.select(["id", "visitor_id"])
		.where("site_id", "=", siteId)
		.where("email", "=", email)
		.executeTakeFirst();

	if (visitor) {
		const sessionId = generateId();
		await db
			.insertInto("sessions")
			.values({
				id: sessionId,
				site_id: siteId,
				visitor_id: visitor.visitor_id,
				started_at: new Date().toISOString(),
				ended_at: new Date().toISOString(),
				entry_path: "/webhook",
				exit_path: "/webhook",
				referrer: null,
				utm_source: null,
				utm_medium: null,
				utm_campaign: null,
				country: null,
				region: null,
				city: null,
				device_type: "webhook",
				browser: null,
				os: null,
				page_count: 1,
				is_bounce: 0,
				fingerprint: null,
			})
			.execute();

		await db
			.insertInto("events")
			.values({
				id: generateId(),
				site_id: siteId,
				session_id: sessionId,
				visitor_id: visitor.visitor_id,
				timestamp: new Date().toISOString(),
				event_type: "custom",
				name: `webhook_${eventType}`,
				path: "/webhook",
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
				device_type: "webhook",
				browser: null,
				os: null,
				revenue: null,
				props: JSON.stringify({ email, source: "webhook" }),
				fingerprint: null,
			})
			.execute();
	}
}

// POST /mailchimp - Handle Mailchimp webhooks
webhookRoutes.post("/mailchimp", async (c) => {
	const db = c.get("db");
	const siteId = c.req.query("site_id");
	if (!siteId) return c.json({ error: "site_id required", success: false }, 400);

	const integration = await findIntegration(db, siteId, "mailchimp");
	if (!integration)
		return c.json({ error: "No active Mailchimp integration found", success: false }, 404);

	const config = JSON.parse((integration.config as string) || "{}");
	const rawBody = await c.req.text();

	// Mailchimp does not sign webhooks: the secret rides in the URL (?token=) it was given.
	// Without a saved secret every request is refused, so nobody can post events for this site.
	const webhookSecret = config.webhook_secret;
	const signature = c.req.header("X-Mailchimp-Signature") || "";
	const urlToken = c.req.query("token") || "";
	const authentic =
		Boolean(webhookSecret) &&
		(timingSafeEqual(urlToken, webhookSecret) ||
			(signature !== "" && (await validateHmac(rawBody, webhookSecret, signature))));
	if (!authentic) return c.json({ error: "Invalid webhook credentials", success: false }, 401);

	const body = parseWebhookBody(rawBody, c.req.header("content-type"));
	if (!body) return c.json({ error: "Invalid body", success: false }, 400);

	try {
		const email = (body.data as Record<string, string>)?.email || (body.email as string) || "";
		const eventType = (body.type as string) || "unknown";

		if (email) {
			await processWebhookEvent(db, siteId, email, `mailchimp_${eventType}`);
		}

		await logWebhookEvent(
			db,
			siteId,
			integration.id,
			`mailchimp_${eventType}`,
			rawBody,
			"processed",
		);
	} catch (_err) {
		await logWebhookEvent(db, siteId, integration.id, "mailchimp_error", rawBody, "failed");
	}

	return c.json({ success: true });
});

// POST /convertkit - Handle ConvertKit webhooks
webhookRoutes.post("/convertkit", async (c) => {
	const db = c.get("db");
	const siteId = c.req.query("site_id");
	if (!siteId) return c.json({ error: "site_id required", success: false }, 400);

	const integration = await findIntegration(db, siteId, "convertkit");
	if (!integration)
		return c.json({ error: "No active ConvertKit integration found", success: false }, 404);

	const config = JSON.parse((integration.config as string) || "{}");
	const apiKey = config.api_key;

	const providedKey = c.req.header("X-ConvertKit-Api-Key") || c.req.query("api_key") || "";
	if (!apiKey || !timingSafeEqual(providedKey, apiKey)) {
		return c.json({ error: "Invalid API key", success: false }, 401);
	}

	const body = parseWebhookBody(await c.req.text(), c.req.header("content-type"));
	if (!body) return c.json({ error: "Invalid body", success: false }, 400);
	const payloadStr = JSON.stringify(body);

	try {
		const email =
			(body.subscriber as Record<string, string>)?.email_address ||
			(body.subscriber as Record<string, string>)?.email ||
			(body.email as string) ||
			"";
		const eventType = (body.event as string) || (body.type as string) || "unknown";

		if (email) {
			await processWebhookEvent(db, siteId, email, `convertkit_${eventType}`);
		}

		await logWebhookEvent(
			db,
			siteId,
			integration.id,
			`convertkit_${eventType}`,
			payloadStr,
			"processed",
		);
	} catch (_err) {
		await logWebhookEvent(db, siteId, integration.id, "convertkit_error", payloadStr, "failed");
	}

	return c.json({ success: true });
});

// POST /kit - Handle Kit webhooks
webhookRoutes.post("/kit", async (c) => {
	const db = c.get("db");
	const siteId = c.req.query("site_id");
	if (!siteId) return c.json({ error: "site_id required", success: false }, 400);

	const integration = await findIntegration(db, siteId, "kit");
	if (!integration)
		return c.json({ error: "No active Kit integration found", success: false }, 404);

	const config = JSON.parse((integration.config as string) || "{}");
	const apiKey = config.api_key;

	const providedKey = c.req.header("X-Kit-Api-Key") || c.req.query("api_key") || "";
	if (!apiKey || !timingSafeEqual(providedKey, apiKey)) {
		return c.json({ error: "Invalid API key", success: false }, 401);
	}

	const body = parseWebhookBody(await c.req.text(), c.req.header("content-type"));
	if (!body) return c.json({ error: "Invalid body", success: false }, 400);
	const payloadStr = JSON.stringify(body);

	try {
		const email =
			(body.subscriber as Record<string, string>)?.email_address ||
			(body.subscriber as Record<string, string>)?.email ||
			(body.email as string) ||
			"";
		const eventType = (body.event as string) || (body.type as string) || "unknown";

		if (email) {
			await processWebhookEvent(db, siteId, email, `kit_${eventType}`);
		}

		await logWebhookEvent(db, siteId, integration.id, `kit_${eventType}`, payloadStr, "processed");
	} catch (_err) {
		await logWebhookEvent(db, siteId, integration.id, "kit_error", payloadStr, "failed");
	}

	return c.json({ success: true });
});

// POST /beehiiv - Handle Beehiiv webhooks
webhookRoutes.post("/beehiiv", async (c) => {
	const db = c.get("db");
	const siteId = c.req.query("site_id");
	if (!siteId) return c.json({ error: "site_id required", success: false }, 400);

	const integration = await findIntegration(db, siteId, "beehiiv");
	if (!integration)
		return c.json({ error: "No active Beehiiv integration found", success: false }, 404);

	const config = JSON.parse((integration.config as string) || "{}");
	const secret = config.webhook_secret;

	const rawBody = await c.req.text();
	// Fail closed: without a saved secret anyone could post subscriber events for this site.
	const signature = c.req.header("X-Beehiiv-Signature") || "";
	if (!secret || !signature || !(await validateHmac(rawBody, secret, signature))) {
		return c.json({ error: "Invalid webhook signature", success: false }, 401);
	}

	const body = parseWebhookBody(rawBody, c.req.header("content-type"));
	if (!body) return c.json({ error: "Invalid body", success: false }, 400);

	try {
		const email = (body.data as Record<string, string>)?.email || (body.email as string) || "";
		const eventType = (body.event_type as string) || (body.type as string) || "unknown";

		if (email) {
			await processWebhookEvent(db, siteId, email, `beehiiv_${eventType}`);
		}

		await logWebhookEvent(db, siteId, integration.id, `beehiiv_${eventType}`, rawBody, "processed");
	} catch (_err) {
		await logWebhookEvent(db, siteId, integration.id, "beehiiv_error", rawBody, "failed");
	}

	return c.json({ success: true });
});
