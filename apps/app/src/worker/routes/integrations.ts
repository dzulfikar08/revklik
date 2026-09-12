import { Hono } from "hono";
import type { Kysely } from "kysely";
import type { Integration, IntegrationType, KlikapaDatabase } from "@revklik/shared";
import { generateId } from "../utils";
import { signAscToken } from "../lib/appstoreconnect";

type Variables = { db: Kysely<KlikapaDatabase>; userId: string };
export const integrationRoutes = new Hono<{ Variables: Variables }>();

const VALID_TYPES: IntegrationType[] = [
	"mailchimp",
	"convertkit",
	"kit",
	"beehiiv",
	"meta_ads",
	"google_ads",
	"appstoreconnect",
];

function maskApiKey(key: string): string {
	if (key.length <= 4) return "****";
	return `****${key.slice(-4)}`;
}

function maskConfig(config: Record<string, string>): Record<string, string> {
	const masked: Record<string, string> = {};
	for (const [k, v] of Object.entries(config)) {
		if (
			[
				"api_key",
				"api_secret",
				"access_token",
				"client_secret",
				"refresh_token",
				"private_key",
			].includes(k)
		) {
			masked[k] = maskApiKey(v);
		} else {
			masked[k] = v;
		}
	}
	return masked;
}

function rowToIntegration(row: Record<string, unknown>): Integration {
	return {
		id: row.id as string,
		site_id: row.site_id as string,
		type: row.type as IntegrationType,
		name: row.name as string,
		config: maskConfig(JSON.parse((row.config as string) || "{}")),
		enabled: Number(row.enabled) === 1,
		last_sync: (row.last_sync as string) || null,
		created_at: row.created_at as string,
	};
}

function validateSite(db: Kysely<KlikapaDatabase>, userId: string, siteId: string) {
	return db
		.selectFrom("sites")
		.select(["id"])
		.where("id", "=", siteId)
		.where("user_id", "=", userId)
		.executeTakeFirst();
}

// GET / - List integrations for a site
integrationRoutes.get("/", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	const siteId = c.req.query("site_id");
	if (!siteId) return c.json({ error: "site_id required", success: false }, 400);

	const site = await validateSite(db, userId, siteId);
	if (!site) return c.json({ error: "Site not found", success: false }, 404);

	const rows = await db
		.selectFrom("integrations")
		.select(["id", "site_id", "type", "name", "config", "enabled", "last_sync", "created_at"])
		.where("site_id", "=", siteId)
		.orderBy("created_at", "desc")
		.execute();

	const integrations = rows.map(rowToIntegration);
	return c.json({ data: integrations, success: true });
});

// POST / - Create integration
integrationRoutes.post("/", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	const body = await c.req.json();
	const { site_id, type, name, config } = body;

	if (!site_id || !type || !name) {
		return c.json({ error: "site_id, type, and name are required", success: false }, 400);
	}
	if (!VALID_TYPES.includes(type)) {
		return c.json(
			{
				error: `Invalid integration type. Must be one of: ${VALID_TYPES.join(", ")}`,
				success: false,
			},
			400,
		);
	}
	if (!config || typeof config !== "object") {
		return c.json({ error: "config must be an object", success: false }, 400);
	}

	const site = await validateSite(db, userId, site_id);
	if (!site) return c.json({ error: "Site not found", success: false }, 404);

	// Check for duplicate type on same site
	const existing = await db
		.selectFrom("integrations")
		.select(["id"])
		.where("site_id", "=", site_id)
		.where("type", "=", type)
		.executeTakeFirst();
	if (existing) {
		return c.json(
			{
				error: `Integration of type '${type}' already exists for this site`,
				success: false,
			},
			409,
		);
	}

	const id = generateId();
	const now = new Date().toISOString();
	await db
		.insertInto("integrations")
		.values({
			id,
			site_id,
			user_id: userId,
			type,
			name,
			config: JSON.stringify(config),
			enabled: 1,
			last_sync: null,
			created_at: now,
		})
		.execute();

	const row = await db
		.selectFrom("integrations")
		.select(["id", "site_id", "type", "name", "config", "enabled", "last_sync", "created_at"])
		.where("id", "=", id)
		.executeTakeFirst();

	if (!row) return c.json({ error: "Integration not found", success: false }, 404);
	return c.json({ data: rowToIntegration(row), success: true }, 201);
});

// PATCH /:id - Update integration
integrationRoutes.patch("/:id", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	const integrationId = c.req.param("id");
	const body = await c.req.json();

	const integration = await db
		.selectFrom("integrations")
		.select(["id", "site_id", "config"])
		.where("id", "=", integrationId)
		.executeTakeFirst();
	if (!integration) return c.json({ error: "Integration not found", success: false }, 404);

	const site = await validateSite(db, userId, integration.site_id);
	if (!site) return c.json({ error: "Not found", success: false }, 404);

	const updates: Record<string, unknown> = {};
	if (body.name !== undefined) updates.name = body.name;
	if (body.config !== undefined) {
		if (typeof body.config !== "object")
			return c.json({ error: "config must be an object", success: false }, 400);
		// Merge — the dashboard form only sends fields the user changed, and
		// secrets come back masked (never round-tripped), so replacing wholesale
		// would drop every unedited field.
		let current: Record<string, string> = {};
		try {
			current = JSON.parse(integration.config || "{}");
		} catch {
			/* stored config may be invalid JSON — start clean */
		}
		updates.config = JSON.stringify({ ...current, ...body.config });
	}
	if (body.enabled !== undefined) updates.enabled = body.enabled ? 1 : 0;

	if (Object.keys(updates).length > 0) {
		await db.updateTable("integrations").set(updates).where("id", "=", integrationId).execute();
	}

	const row = await db
		.selectFrom("integrations")
		.select(["id", "site_id", "type", "name", "config", "enabled", "last_sync", "created_at"])
		.where("id", "=", integrationId)
		.executeTakeFirst();

	if (!row) return c.json({ error: "Integration not found", success: false }, 404);
	return c.json({ data: rowToIntegration(row), success: true });
});

// DELETE /:id - Delete integration
integrationRoutes.delete("/:id", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	const integrationId = c.req.param("id");

	const integration = await db
		.selectFrom("integrations")
		.select(["id", "site_id"])
		.where("id", "=", integrationId)
		.executeTakeFirst();
	if (!integration) return c.json({ error: "Integration not found", success: false }, 404);

	const site = await validateSite(db, userId, integration.site_id);
	if (!site) return c.json({ error: "Not found", success: false }, 404);

	await db.deleteFrom("webhook_events").where("integration_id", "=", integrationId).execute();
	await db.deleteFrom("integrations").where("id", "=", integrationId).execute();

	return c.json({ success: true });
});

// POST /:id/test - Test integration connection
integrationRoutes.post("/:id/test", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	const integrationId = c.req.param("id");

	const integration = await db
		.selectFrom("integrations")
		.select(["id", "site_id", "type", "config"])
		.where("id", "=", integrationId)
		.executeTakeFirst();
	if (!integration) return c.json({ error: "Integration not found", success: false }, 404);

	const site = await validateSite(db, userId, integration.site_id);
	if (!site) return c.json({ error: "Not found", success: false }, 404);

	const config = JSON.parse((integration.config as string) || "{}");
	const intType = integration.type as IntegrationType;
	let testResult: { ok: boolean; message: string; detail?: string };

	try {
		testResult = await testConnection(intType, config);

		if (testResult.ok) {
			await db
				.updateTable("integrations")
				.set({ last_sync: new Date().toISOString() })
				.where("id", "=", integrationId)
				.execute();
		}

		// Log the test as a webhook event
		await db
			.insertInto("webhook_events")
			.values({
				id: generateId(),
				site_id: integration.site_id,
				integration_id: integrationId,
				direction: "outbound",
				event_type: "test",
				payload: JSON.stringify({
					success: testResult.ok,
					message: testResult.message,
				}),
				status: testResult.ok ? "processed" : "failed",
				attempts: 1,
				created_at: new Date().toISOString(),
				processed_at: new Date().toISOString(),
			})
			.execute();
	} catch (err) {
		testResult = {
			ok: false,
			message: "Connection test failed",
			detail: err instanceof Error ? err.message : "Unknown error",
		};
	}

	return c.json({ data: testResult, success: true });
});

// GET /:id/events - Get webhook event log
integrationRoutes.get("/:id/events", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	const integrationId = c.req.param("id");

	const integration = await db
		.selectFrom("integrations")
		.select(["id", "site_id"])
		.where("id", "=", integrationId)
		.executeTakeFirst();
	if (!integration) return c.json({ error: "Integration not found", success: false }, 404);

	const site = await validateSite(db, userId, integration.site_id);
	if (!site) return c.json({ error: "Not found", success: false }, 404);

	const rows = await db
		.selectFrom("webhook_events")
		.select(["id", "integration_id", "direction", "event_type", "status", "created_at"])
		.where("integration_id", "=", integrationId)
		.orderBy("created_at", "desc")
		.limit(50)
		.execute();

	const events = rows.map((r) => ({
		id: r.id,
		integration_id: r.integration_id,
		direction: r.direction as "inbound" | "outbound",
		event_type: r.event_type,
		status: r.status as "pending" | "processed" | "failed",
		created_at: r.created_at,
	}));

	return c.json({ data: events, success: true });
});

// Test connection helpers
async function testConnection(
	type: IntegrationType,
	config: Record<string, string>,
): Promise<{ ok: boolean; message: string; detail?: string }> {
	switch (type) {
		case "mailchimp": {
			const dc = config.dc || config.server_prefix || "us1";
			const apiKey = config.api_key;
			if (!apiKey) return { ok: false, message: "API key is required" };
			const res = await fetch(`https://${dc}.api.mailchimp.com/3.0/ping`, {
				headers: { Authorization: `Basic ${btoa(`any:${apiKey}`)}` },
			});
			if (res.ok) return { ok: true, message: "Mailchimp connection successful" };
			return {
				ok: false,
				message: "Mailchimp authentication failed",
				detail: `HTTP ${res.status}`,
			};
		}
		case "convertkit":
		case "kit": {
			const apiKey = config.api_key;
			if (!apiKey) return { ok: false, message: "API key is required" };
			const res = await fetch(`https://api.convertkit.com/v3/account?api_key=${apiKey}`);
			if (res.ok)
				return {
					ok: true,
					message: `${type === "kit" ? "Kit" : "ConvertKit"} connection successful`,
				};
			return {
				ok: false,
				message: `${type === "kit" ? "Kit" : "ConvertKit"} authentication failed`,
				detail: `HTTP ${res.status}`,
			};
		}
		case "beehiiv": {
			const apiKey = config.api_key;
			const publicationId = config.publication_id;
			if (!apiKey || !publicationId)
				return {
					ok: false,
					message: "API key and Publication ID are required",
				};
			const res = await fetch(`https://api.beehiiv.com/v2/publications/${publicationId}`, {
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
				},
			});
			if (res.ok) return { ok: true, message: "Beehiiv connection successful" };
			return {
				ok: false,
				message: "Beehiiv authentication failed",
				detail: `HTTP ${res.status}`,
			};
		}
		case "meta_ads": {
			const accessToken = config.access_token;
			if (!accessToken) return { ok: false, message: "Access token is required" };
			const res = await fetch(`https://graph.facebook.com/v18.0/me?access_token=${accessToken}`);
			if (res.ok) return { ok: true, message: "Meta Ads connection successful" };
			return {
				ok: false,
				message: "Meta Ads authentication failed",
				detail: `HTTP ${res.status}`,
			};
		}
		case "google_ads": {
			const { client_id, client_secret, refresh_token, customer_id } = config;
			if (!client_id || !client_secret || !refresh_token || !customer_id) {
				return {
					ok: false,
					message: "All fields are required (client_id, client_secret, refresh_token, customer_id)",
				};
			}
			// Validate by attempting to get an access token
			const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({
					client_id,
					client_secret,
					refresh_token,
					grant_type: "refresh_token",
				}),
			});
			if (tokenRes.ok) return { ok: true, message: "Google Ads credentials validated" };
			const errData = await tokenRes.json().catch(() => ({}));
			return {
				ok: false,
				message: "Google Ads authentication failed",
				detail: (errData as Record<string, string>).error_description || `HTTP ${tokenRes.status}`,
			};
		}
		case "appstoreconnect": {
			const { issuer_id, key_id, private_key, app_id, vendor_number } = config;
			if (!issuer_id || !key_id || !private_key || !app_id || !vendor_number) {
				return {
					ok: false,
					message: "issuer_id, key_id, private_key (.p8), app_id, and vendor_number are required",
				};
			}
			try {
				const token = await signAscToken({ issuer_id, key_id, private_key });
				const res = await fetch(
					`https://api.appstoreconnect.apple.com/v1/apps/${encodeURIComponent(app_id)}`,
					{ headers: { Authorization: `Bearer ${token}` } },
				);
				if (res.ok) return { ok: true, message: "App Store Connect connection successful" };
				return {
					ok: false,
					message: "App Store Connect authentication failed",
					detail:
						res.status === 401
							? "Key rejected — check issuer_id, key_id, and the .p8 key"
							: res.status === 403
								? "Key lacks access to this app (needs Admin or App Manager role)"
								: `HTTP ${res.status}`,
				};
			} catch (err) {
				return {
					ok: false,
					message: "Invalid .p8 private key",
					detail: err instanceof Error ? err.message : undefined,
				};
			}
		}
		default:
			return { ok: false, message: `Unknown integration type: ${type}` };
	}
}
