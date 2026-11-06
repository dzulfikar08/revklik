import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import type { Env } from "../types";
import { generateId, hashToken } from "../utils";
import {
	fetchServiceAccountAccessToken,
	GscServiceAccountError,
	parseServiceAccountKey,
} from "../lib/gsc-service-account";
import { checkSiteAccess, requireSiteAccess } from "../lib/site-access";
import { signOAuthState, verifyOAuthState } from "../lib/oauth-state";
import { syncGscIntegration } from "../lib/gsc-sync";

export const gscRoutes = new Hono<Env>();

const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

// Protected GSC routes (queries, sync): unexpired kp_ sessions, plus rvt_
// account tokens because the CLI calls them. Site-scoped rv_ tokens are refused.
const gscAuth = createMiddleware<Env>(async (c, next) => {
	const authHeader = c.req.header("Authorization");
	if (!authHeader?.startsWith("Bearer "))
		return c.json({ error: "Unauthorized", success: false }, 401);
	const db = c.get("db");
	if (!db) return c.json({ error: "Database unavailable", success: false }, 503);
	const apiKey = await db
		.selectFrom("api_keys")
		.select(["user_id", "token_type", "expires_at"])
		.where("key_hash", "=", await hashToken(authHeader.slice(7)))
		.executeTakeFirst();
	if (!apiKey) return c.json({ error: "Invalid token", success: false }, 401);
	if (apiKey.token_type !== "session" && apiKey.token_type !== "account")
		return c.json({ error: "Session or account token required", success: false }, 401);
	if (apiKey.expires_at && new Date(apiKey.expires_at) <= new Date())
		return c.json({ error: "Token expired", success: false }, 401);
	c.set("userId", apiKey.user_id);
	await next();
});

gscRoutes.use("/queries/*", gscAuth);
gscRoutes.use("/sync/*", gscAuth);
gscRoutes.use("/service-account/*", gscAuth);
gscRoutes.use("/auth-url", gscAuth);

// Helper: get integration config for GSC
async function getGSCIntegration(db: Kysely<KlikapaDatabase>, siteId: string) {
	return db
		.selectFrom("integrations")
		.select(["id", "config", "site_id"])
		.where("site_id", "=", siteId)
		.where("type", "=", "google_search_console")
		.executeTakeFirst();
}

// Normalize a GSC siteUrl to a bare host for comparison.
// Handles "sc-domain:example.com" (domain property) and "https://www.example.com/" (URL prefix).
function normalizeGscHost(siteUrl: string): string {
	return siteUrl
		.replace(/^sc-domain:/, "")
		.replace(/^https?:\/\//, "")
		.replace(/^www\./, "")
		.replace(/\/.*$/, "")
		.toLowerCase();
}

function gscSiteMatchesDomain(siteUrl: string, domain: string): boolean {
	const host = normalizeGscHost(siteUrl);
	const bareDomain = domain.replace(/^www\./, "").toLowerCase();
	if (!host || !bareDomain) return false;
	if (host === bareDomain) return true;
	// Domain properties cover all subdomains
	return bareDomain.endsWith(`.${host}`);
}

// POST /auth-url - Start the Google OAuth flow for GSC. Authenticated: the consent
// redirect carries a signed state naming the user and site, which /callback verifies.
gscRoutes.post("/auth-url", async (c) => {
	const body = (await c.req.json().catch(() => null)) as { site_id?: string } | null;
	const siteId = body?.site_id;
	if (!siteId) return c.json({ error: "site_id required", success: false }, 400);
	const access = await requireSiteAccess(c, siteId, "manage");
	if (access instanceof Response) return access;

	const clientId = c.env.GOOGLE_CLIENT_ID || "";
	const secret = c.env.GOOGLE_CLIENT_SECRET || "";
	if (!clientId || !secret) {
		return c.json({ error: "Google sign-in is not configured", success: false }, 503);
	}
	const redirectUri = `${new URL(c.req.url).origin}/api/gsc/callback`;
	const state = await signOAuthState(secret, { u: c.get("userId"), s: siteId });

	const params = new URLSearchParams({
		client_id: clientId,
		redirect_uri: redirectUri,
		response_type: "code",
		scope: GSC_SCOPE,
		state,
		access_type: "offline",
		prompt: "consent",
	});

	return c.json({
		data: { url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` },
		success: true,
	});
});

// GET /callback - Handle Google OAuth callback
gscRoutes.get("/callback", async (c) => {
	const db = c.get("db");
	if (!db) return c.json({ error: "DB unavailable", success: false }, 503);

	const code = c.req.query("code");
	const stateStr = c.req.query("state");
	if (!code || !stateStr) return c.json({ error: "Missing code or state", success: false }, 400);

	const secret = c.env.GOOGLE_CLIENT_SECRET || "";
	const state = secret ? await verifyOAuthState(secret, stateStr) : null;
	if (!state) {
		return c.json({ error: "Invalid or expired state parameter", success: false }, 400);
	}
	// The user who started the flow must still be allowed to connect credentials to the site.
	const { denied } = await checkSiteAccess(db, state.u, state.s, "manage");
	if (denied) return c.json({ error: denied.error, success: false }, denied.status);

	const clientId = c.env.GOOGLE_CLIENT_ID || "";
	const clientSecret = c.env.GOOGLE_CLIENT_SECRET || "";
	const redirectUri = `${new URL(c.req.url).origin}/api/gsc/callback`;

	// Exchange code for tokens
	let tokenRes: {
		access_token?: string;
		refresh_token?: string;
		error?: string;
		error_description?: string;
	};
	try {
		const tr = await fetch("https://oauth2.googleapis.com/token", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				code,
				client_id: clientId,
				client_secret: clientSecret,
				redirect_uri: redirectUri,
				grant_type: "authorization_code",
			}),
		});
		tokenRes = await tr.json();
	} catch {
		return c.json({ error: "OAuth token exchange failed", success: false }, 500);
	}
	if (tokenRes.error) {
		return c.json({ error: tokenRes.error_description || tokenRes.error, success: false }, 400);
	}

	const accessToken = tokenRes.access_token as string;
	const refreshToken = tokenRes.refresh_token as string | undefined;
	if (!refreshToken) {
		return c.json(
			{
				error: "No refresh token received. Please revoke access and try again.",
				success: false,
			},
			400,
		);
	}

	// Pick the GSC property that matches this site's domain (fallback: first entry)
	const siteId = state.s;
	let googleSiteUrl = "";
	try {
		const [siteRow, sitesRes] = await Promise.all([
			db.selectFrom("sites").select(["domain"]).where("id", "=", siteId).executeTakeFirst(),
			fetch("https://www.googleapis.com/webmasters/v3/sites", {
				headers: { Authorization: `Bearer ${accessToken}` },
			}),
		]);
		if (sitesRes.ok) {
			const sitesData = (await sitesRes.json()) as {
				siteEntry?: Array<{ siteUrl: string }>;
			};
			const entries = sitesData.siteEntry ?? [];
			const domain = siteRow?.domain ?? "";
			const match = domain
				? entries.find((e) => gscSiteMatchesDomain(e.siteUrl, domain))
				: undefined;
			googleSiteUrl = (match ?? entries[0])?.siteUrl ?? "";
		}
	} catch {
		// Non-fatal: we'll store what we have
	}

	// Store as integration
	const config = JSON.stringify({
		access_token: accessToken,
		refresh_token: refreshToken,
		google_site_url: googleSiteUrl,
	});

	const existing = await db
		.selectFrom("integrations")
		.select(["id"])
		.where("site_id", "=", siteId)
		.where("type", "=", "google_search_console")
		.executeTakeFirst();

	if (existing) {
		await db
			.updateTable("integrations")
			.set({ config, last_sync: new Date().toISOString() })
			.where("id", "=", existing.id)
			.execute();
	} else {
		await db
			.insertInto("integrations")
			.values({
				id: generateId(),
				site_id: siteId,
				user_id: state.u,
				type: "google_search_console",
				name: "Google Search Console",
				config,
				enabled: 1,
				last_sync: new Date().toISOString(),
				created_at: new Date().toISOString(),
			})
			.execute();
	}

	// Redirect back to client integrations page
	const appUrl = `${new URL(c.req.url).origin}/integrations`;
	return c.redirect(appUrl);
});

// POST /service-account - Connect a site with a Google service account JSON key.
// Body: { site_id, key: <service account JSON object or string>, google_site_url? }.
// The service account email must be added as a user on the Search Console property.
gscRoutes.post("/service-account", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	if (!db) return c.json({ error: "DB unavailable", success: false }, 503);

	const body = (await c.req.json().catch(() => null)) as {
		site_id?: string;
		key?: unknown;
		google_site_url?: string;
	} | null;
	if (!body?.site_id || body.key === undefined) {
		return c.json({ error: "site_id and key required", success: false }, 400);
	}

	const access = await requireSiteAccess(c, body.site_id, "manage");
	if (access instanceof Response) return access;

	let key;
	try {
		key = parseServiceAccountKey(body.key);
	} catch (err) {
		const message = err instanceof GscServiceAccountError ? err.message : "Invalid key";
		return c.json({ error: message, success: false }, 400);
	}

	let googleSiteUrl = body.google_site_url?.trim() ?? "";
	if (!googleSiteUrl) {
		try {
			const accessToken = await fetchServiceAccountAccessToken(key);
			const res = await fetch("https://www.googleapis.com/webmasters/v3/sites", {
				headers: { Authorization: `Bearer ${accessToken}` },
			});
			if (!res.ok) throw new Error(`GSC sites list failed (${res.status})`);
			const data = (await res.json()) as { siteEntry?: Array<{ siteUrl: string }> };
			googleSiteUrl =
				(data.siteEntry ?? []).find((e) => gscSiteMatchesDomain(e.siteUrl, access.domain))
					?.siteUrl ?? "";
		} catch (err) {
			return c.json(
				{
					error: err instanceof Error ? err.message : "Service account check failed",
					success: false,
				},
				401,
			);
		}
		if (!googleSiteUrl) {
			return c.json(
				{
					error: `No Search Console property for ${access.domain} is shared with ${key.client_email}. Add it as a user in Search Console, or pass google_site_url.`,
					success: false,
				},
				409,
			);
		}
	}

	const config = JSON.stringify({
		auth: "service_account",
		client_email: key.client_email,
		private_key: key.private_key,
		google_site_url: googleSiteUrl,
	});
	const existing = await getGSCIntegration(db, body.site_id);
	if (existing) {
		await db.updateTable("integrations").set({ config }).where("id", "=", existing.id).execute();
	} else {
		await db
			.insertInto("integrations")
			.values({
				id: generateId(),
				site_id: body.site_id,
				user_id: userId,
				type: "google_search_console",
				name: "Google Search Console",
				config,
				enabled: 1,
				last_sync: null,
				created_at: new Date().toISOString(),
			})
			.execute();
	}
	return c.json({
		data: { client_email: key.client_email, google_site_url: googleSiteUrl },
		success: true,
	});
});

// GET /queries - Fetch search query data
gscRoutes.get("/queries", async (c) => {
	const db = c.get("db");
	if (!db) return c.json({ error: "DB unavailable", success: false }, 503);

	const siteId = c.req.query("site_id");
	if (!siteId) return c.json({ error: "site_id required", success: false }, 400);

	const access = await requireSiteAccess(c, siteId, "read");
	if (access instanceof Response) return access;

	// Return last 30 days of stored search console data
	const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0] ?? "";
	const rows = await db
		.selectFrom("search_console_data")
		.select(["query", "date", "clicks", "impressions", "ctr", "position"])
		.where("site_id", "=", siteId)
		.where("date", ">=", thirtyDaysAgo)
		.orderBy("date", "desc")
		.orderBy("clicks", "desc")
		.limit(500)
		.execute();

	return c.json({ data: rows, success: true });
});

// POST /sync - Sync search console data now: the last `days` days (default 7, max 45), ending 2 days ago.
gscRoutes.post("/sync", async (c) => {
	const db = c.get("db");
	if (!db) return c.json({ error: "DB unavailable", success: false }, 503);

	const siteId = c.req.query("site_id");
	if (!siteId) return c.json({ error: "site_id required", success: false }, 400);
	const days = Math.min(45, Math.max(1, Number.parseInt(c.req.query("days") ?? "7", 10) || 7));

	const access = await requireSiteAccess(c, siteId, "write");
	if (access instanceof Response) return access;

	const integration = await db
		.selectFrom("integrations")
		.select(["id", "config", "site_id", "synced_through"])
		.where("site_id", "=", siteId)
		.where("type", "=", "google_search_console")
		.executeTakeFirst();
	if (!integration)
		return c.json(
			{ error: "Google Search Console not connected. Please authorize first.", success: false },
			404,
		);

	try {
		const r = await syncGscIntegration(
			db,
			integration,
			{ clientId: c.env.GOOGLE_CLIENT_ID, clientSecret: c.env.GOOGLE_CLIENT_SECRET },
			{ budget: { n: 0, max: 48 }, days },
		);
		return c.json({
			data: { synced: r.rows, days: r.days_synced, synced_through: r.synced_through, budget_exhausted: r.budget_exhausted },
			success: true,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : "GSC sync failed";
		return c.json({ error: message, success: false }, message.startsWith("GSC API error") ? 502 : 401);
	}
});
