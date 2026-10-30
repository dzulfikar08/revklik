import { Hono } from "hono";
import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { appUrl } from "../lib/app-url";
import {
	type PolarConfig,
	type PolarSyncResult,
	PolarApiError,
	findPolarProvider,
	recordSyncState,
	summarizeSync,
	syncPolarOrders,
} from "../lib/polar-sync";
import { requireSiteAccess } from "../lib/site-access";
import type { Env } from "../types";
import { generateId } from "../utils";

/**
 * Dashboard side of the per-site Polar connection: where the webhook secret and the
 * optional Organization Access Token are saved, what the endpoint has received, and
 * the manual order sync. Secrets go in; only "configured" flags come back out.
 */
export const polarConnectRoutes = new Hono<Env>();

const MAX_SECRET_LENGTH = 512;
const MAX_LOOKBACK_DAYS = 3650;
const DEFAULT_LOOKBACK_DAYS = 90;
const RECENT_EVENT_LIMIT = 10;

interface PolarStatus {
	site_id: string;
	webhook_url: string;
	connected: boolean;
	webhook_secret_configured: boolean;
	access_token_configured: boolean;
	organization_id: string;
	last_sync_at: string | null;
	last_sync_summary: string;
	last_sync_error: string;
	events: { id: string; event_type: string; status: string; created_at: string }[];
}

function publicOrigin(c: { env: Env["Bindings"]; req: { url: string } }): string {
	return c.env.APP_URL?.trim() ? appUrl(c.env) : new URL(c.req.url).origin;
}

async function loadStatus(
	db: Kysely<KlikapaDatabase>,
	origin: string,
	siteId: string,
): Promise<PolarStatus> {
	const provider = await findPolarProvider(db, siteId);
	const config: PolarConfig = provider?.config ?? {};
	const events = provider
		? await db
				.selectFrom("webhook_events")
				.select(["id", "event_type", "status", "created_at"])
				.where("site_id", "=", siteId)
				.where("integration_id", "=", provider.id)
				.where("direction", "=", "inbound")
				.orderBy("created_at", "desc")
				.limit(RECENT_EVENT_LIMIT)
				.execute()
		: [];
	return {
		site_id: siteId,
		webhook_url: `${origin}/api/webhooks/polar?site_id=${encodeURIComponent(siteId)}`,
		connected: Boolean(provider),
		webhook_secret_configured: Boolean(config.webhook_secret),
		access_token_configured: Boolean(config.access_token),
		organization_id: config.organization_id ?? "",
		last_sync_at: config.last_sync_at ?? null,
		last_sync_summary: config.last_sync_summary ?? "",
		last_sync_error: config.last_sync_error ?? "",
		events,
	};
}

// GET /status?site_id= : what the dashboard panel shows. Never includes a secret.
polarConnectRoutes.get("/status", async (c) => {
	const db = c.get("db");
	const siteId = c.req.query("site_id");
	if (!siteId) return c.json({ error: "site_id required", success: false }, 400);
	const access = await requireSiteAccess(c, siteId, "read");
	if (access instanceof Response) return access;
	return c.json({ data: await loadStatus(db, publicOrigin(c), siteId), success: true });
});

/** A trimmed string field of the request body: undefined when absent, null when malformed. */
function secretField(body: Record<string, unknown>, key: string): string | null | undefined {
	const raw = body[key];
	if (raw === undefined) return undefined;
	if (typeof raw !== "string") return null;
	const value = raw.trim();
	return value.length <= MAX_SECRET_LENGTH && !/\s/.test(value) ? value : null;
}

// PUT /config: save the webhook secret, the access token and the organization id.
// Fields left out stay as they are; an empty token or organization id clears it.
polarConnectRoutes.put("/config", async (c) => {
	const db = c.get("db");
	const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
	const siteId = typeof body?.site_id === "string" ? body.site_id : "";
	if (!body || !siteId) return c.json({ error: "site_id required", success: false }, 400);
	const access = await requireSiteAccess(c, siteId, "write");
	if (access instanceof Response) return access;

	const secret = secretField(body, "webhook_secret");
	const token = secretField(body, "access_token");
	const organizationId = secretField(body, "organization_id");
	if (secret === null || token === null || organizationId === null) {
		return c.json(
			{
				error: `Values must be text without spaces, up to ${MAX_SECRET_LENGTH} characters. Paste them exactly as Polar shows them.`,
				success: false,
			},
			400,
		);
	}
	if (secret === "") {
		return c.json(
			{
				error: "The webhook secret cannot be empty. Disconnect Polar to remove it.",
				success: false,
			},
			400,
		);
	}
	if (secret === undefined && token === undefined && organizationId === undefined) {
		return c.json({ error: "Nothing to save", success: false }, 400);
	}

	const existing = await findPolarProvider(db, siteId);
	const next: PolarConfig = { ...existing?.config };
	if (secret !== undefined) next.webhook_secret = secret;
	if (token !== undefined) {
		if (token) next.access_token = token;
		else {
			next.access_token = undefined;
			next.last_sync_at = undefined;
			next.last_sync_error = undefined;
			next.last_sync_summary = undefined;
		}
	}
	if (organizationId !== undefined) next.organization_id = organizationId || undefined;
	const config = JSON.stringify(next);

	if (existing) {
		await db
			.updateTable("payment_providers")
			.set({ config, enabled: 1 })
			.where("id", "=", existing.id)
			.execute();
	} else {
		await db
			.insertInto("payment_providers")
			.values({
				id: generateId(),
				site_id: siteId,
				provider: "polar",
				config,
				enabled: 1,
				created_at: new Date().toISOString(),
			})
			.execute();
	}
	return c.json({ data: await loadStatus(db, publicOrigin(c), siteId), success: true });
});

// POST /sync: book the site's Polar orders (sales, Polar's fee, refunds) with the saved token.
polarConnectRoutes.post("/sync", async (c) => {
	const db = c.get("db");
	const body = (await c.req.json().catch(() => null)) as {
		site_id?: unknown;
		days?: unknown;
	} | null;
	const siteId = typeof body?.site_id === "string" ? body.site_id : "";
	if (!siteId) return c.json({ error: "site_id required", success: false }, 400);
	const access = await requireSiteAccess(c, siteId, "write");
	if (access instanceof Response) return access;

	const days = body?.days ?? DEFAULT_LOOKBACK_DAYS;
	const lookbackDays =
		days === "all"
			? null
			: typeof days === "number" && Number.isInteger(days) && days >= 1 && days <= MAX_LOOKBACK_DAYS
				? days
				: undefined;
	if (lookbackDays === undefined) {
		return c.json(
			{
				error: `days must be a whole number from 1 to ${MAX_LOOKBACK_DAYS}, or "all"`,
				success: false,
			},
			400,
		);
	}

	const provider = await findPolarProvider(db, siteId);
	const token = provider?.config.access_token;
	if (!provider || !token) {
		return c.json({ error: "Save a Polar access token first, then sync.", success: false }, 400);
	}

	let result: PolarSyncResult;
	try {
		result = await syncPolarOrders(db, {
			siteId,
			token,
			organizationId: provider.config.organization_id,
			lookbackDays,
			env: c.env,
		});
	} catch (err) {
		if (!(err instanceof PolarApiError)) throw err;
		await recordSyncState(db, provider.id, { summary: "", error: err.message });
		return c.json({ error: err.message, success: false }, 502);
	}
	await recordSyncState(db, provider.id, { summary: summarizeSync(result), error: "" });
	return c.json({ data: result, success: true });
});

// DELETE ?site_id= : disconnect Polar for the site (drops the secret, the token and the event log).
polarConnectRoutes.delete("/", async (c) => {
	const db = c.get("db");
	const siteId = c.req.query("site_id");
	if (!siteId) return c.json({ error: "site_id required", success: false }, 400);
	const access = await requireSiteAccess(c, siteId, "write");
	if (access instanceof Response) return access;
	const provider = await findPolarProvider(db, siteId);
	if (provider) {
		await db.deleteFrom("webhook_events").where("integration_id", "=", provider.id).execute();
		await db.deleteFrom("payment_providers").where("id", "=", provider.id).execute();
	}
	return c.json({ success: true });
});
