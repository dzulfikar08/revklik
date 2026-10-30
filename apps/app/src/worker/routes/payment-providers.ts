import { Hono } from "hono";
import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { requireSiteAccess } from "../lib/site-access";
import { generateId } from "../utils";

type Variables = { db: Kysely<KlikapaDatabase>; userId: string };
export const paymentProviderRoutes = new Hono<{ Variables: Variables }>();

const VALID_PROVIDERS = ["midtrans", "xendit", "doku", "paywuz", "mayar", "stripe", "lemonsqueezy"];

/** Providers whose webhooks carry no signature: the shared secret is the only proof of origin. */
const SECRET_REQUIRED_PROVIDERS = ["paywuz", "mayar"];

function maskConfig(config: Record<string, string>): Record<string, string> {
	const masked: Record<string, string> = {};
	const sensitive = ["server_key", "client_key", "secret_key", "client_secret", "webhook_secret"];
	for (const [k, v] of Object.entries(config)) {
		masked[k] = sensitive.includes(k) ? (v.length <= 4 ? "****" : `****${v.slice(-4)}`) : v;
	}
	return masked;
}

paymentProviderRoutes.get("/", async (c) => {
	const db = c.get("db");
	const siteId = c.req.query("site_id");
	if (!siteId) return c.json({ error: "site_id required" }, 400);
	const access = await requireSiteAccess(c, siteId, "read");
	if (access instanceof Response) return access;
	const rows = await db
		.selectFrom("payment_providers")
		.selectAll()
		.where("site_id", "=", siteId)
		// Polar's secret and token are managed (and never listed) through /api/polar.
		.where("provider", "!=", "polar")
		.orderBy("created_at", "desc")
		.execute();
	return c.json({
		data: rows.map((r) => ({
			...r,
			config: maskConfig(JSON.parse((r.config as string) || "{}")),
			enabled: Number(r.enabled) === 1,
		})),
		success: true,
	});
});

paymentProviderRoutes.post("/", async (c) => {
	const db = c.get("db");
	const { site_id, provider, config } = await c.req.json();
	if (!site_id || !provider || !config)
		return c.json({ error: "site_id, provider, config required" }, 400);
	if (!VALID_PROVIDERS.includes(provider))
		return c.json({ error: `Invalid provider: ${provider}` }, 400);
	if (SECRET_REQUIRED_PROVIDERS.includes(provider) && !String(config.webhook_secret ?? "").trim())
		return c.json({ error: `${provider} requires a webhook_secret` }, 400);
	const access = await requireSiteAccess(c, site_id, "write");
	if (access instanceof Response) return access;
	const existing = await db
		.selectFrom("payment_providers")
		.select(["id"])
		.where("site_id", "=", site_id)
		.where("provider", "=", provider)
		.executeTakeFirst();
	if (existing) return c.json({ error: `${provider} already configured` }, 409);
	const id = generateId();
	await db
		.insertInto("payment_providers")
		.values({
			id,
			site_id,
			provider,
			config: JSON.stringify(config),
			enabled: 1,
			created_at: new Date().toISOString(),
		})
		.execute();
	return c.json({ data: { id, provider, enabled: true }, success: true }, 201);
});

paymentProviderRoutes.delete("/:provider", async (c) => {
	const db = c.get("db");
	const provider = c.req.param("provider");
	const site_id = c.req.query("site_id");
	if (!site_id) return c.json({ error: "site_id required" }, 400);
	// Polar is managed (and removed) through /api/polar, not this generic list.
	if (!VALID_PROVIDERS.includes(provider))
		return c.json({ error: `Invalid provider: ${provider}` }, 400);
	const access = await requireSiteAccess(c, site_id, "write");
	if (access instanceof Response) return access;
	const rows = await db
		.selectFrom("payment_providers")
		.select("id")
		.where("site_id", "=", site_id)
		.where("provider", "=", provider)
		.execute();
	for (const row of rows) {
		await db.deleteFrom("webhook_events").where("integration_id", "=", row.id).execute();
		await db.deleteFrom("payment_providers").where("id", "=", row.id).execute();
	}
	return c.json({ success: true });
});
