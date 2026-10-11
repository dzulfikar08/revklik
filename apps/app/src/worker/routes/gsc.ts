import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import type { Env } from "../types";
import { generateId, hashToken } from "../utils";

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

// Helper: validate user owns the site
async function validateSite(db: Kysely<KlikapaDatabase>, userId: string, siteId: string) {
	return db
		.selectFrom("sites")
		.select(["id", "domain"])
		.where("id", "=", siteId)
		.where((eb) =>
			eb.or([
				eb("user_id", "=", userId),
				eb.exists(
					eb
						.selectFrom("team_members")
						.select("id")
						.where("site_id", "=", siteId)
						.where("user_id", "=", userId)
						.where("accepted_at", "is not", null),
				),
			]),
		)
		.executeTakeFirst();
}

// Helper: refresh access token using refresh token
async function refreshAccessToken(
	refreshToken: string,
	clientId: string,
	clientSecret: string,
): Promise<string> {
	const res = await fetch("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			refresh_token: refreshToken,
			client_id: clientId,
			client_secret: clientSecret,
			grant_type: "refresh_token",
		}),
	});
	const data = (await res.json()) as {
		access_token?: string;
		error?: string;
		error_description?: string;
	};
	if (!res.ok) throw new Error(`Token refresh failed: ${data.error_description || data.error}`);
	if (!data.access_token) throw new Error("Token refresh failed: no access_token in response");
	return data.access_token;
}

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

// Helper: fetch search analytics from Google Search Console API
async function fetchSearchAnalytics(
	accessToken: string,
	siteUrl: string,
	startDate: string,
	endDate: string,
) {
	const res = await fetch(
		`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				startDate,
				endDate,
				dimensions: ["query"],
				rowLimit: 1000,
			}),
		},
	);
	if (!res.ok) {
		const err = (await res.json()) as {
			error?: { message?: string } | string;
		};
		throw new Error(
			`GSC API error: ${(typeof err.error === "object" && err.error?.message) || res.status}`,
		);
	}
	return (await res.json()) as {
		rows?: Array<{
			keys: string[];
			clicks: number;
			impressions: number;
			ctr: number;
			position: number;
		}>;
	};
}

// GET /auth - Start Google OAuth flow for GSC
gscRoutes.get("/auth", async (c) => {
	const siteId = c.req.query("site_id");
	if (!siteId) return c.json({ error: "site_id required", success: false }, 400);

	const clientId = c.env.GOOGLE_CLIENT_ID || "";
	const redirectUri = `${new URL(c.req.url).origin}/api/gsc/callback`;
	const state = JSON.stringify({ site_id: siteId, nonce: crypto.randomUUID() });

	const params = new URLSearchParams({
		client_id: clientId,
		redirect_uri: redirectUri,
		response_type: "code",
		scope: GSC_SCOPE,
		state,
		access_type: "offline",
		prompt: "consent",
	});

	return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

// GET /callback - Handle Google OAuth callback
gscRoutes.get("/callback", async (c) => {
	const db = c.get("db");
	if (!db) return c.json({ error: "DB unavailable", success: false }, 503);

	const code = c.req.query("code");
	const stateStr = c.req.query("state");
	if (!code || !stateStr) return c.json({ error: "Missing code or state", success: false }, 400);

	let state: { site_id: string; nonce: string };
	try {
		state = JSON.parse(stateStr);
	} catch {
		return c.json({ error: "Invalid state parameter", success: false }, 400);
	}
	if (!state.site_id) return c.json({ error: "Missing site_id in state", success: false }, 400);

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
	const siteId = state.site_id;
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
				user_id: "", // Not tied to a specific user in callback context; will be associated via site ownership
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

// GET /queries - Fetch search query data
gscRoutes.get("/queries", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	if (!db) return c.json({ error: "DB unavailable", success: false }, 503);

	const siteId = c.req.query("site_id");
	if (!siteId) return c.json({ error: "site_id required", success: false }, 400);

	const site = await validateSite(db, userId, siteId);
	if (!site) return c.json({ error: "Site not found", success: false }, 404);

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

// POST /sync - Force sync last 7 days of search console data
gscRoutes.post("/sync", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	if (!db) return c.json({ error: "DB unavailable", success: false }, 503);

	const siteId = c.req.query("site_id");
	if (!siteId) return c.json({ error: "site_id required", success: false }, 400);

	const site = await validateSite(db, userId, siteId);
	if (!site) return c.json({ error: "Site not found", success: false }, 404);

	// Get GSC integration config
	const integration = await getGSCIntegration(db, siteId);
	if (!integration)
		return c.json(
			{
				error: "Google Search Console not connected. Please authorize first.",
				success: false,
			},
			404,
		);

	const clientId = c.env.GOOGLE_CLIENT_ID || "";
	const clientSecret = c.env.GOOGLE_CLIENT_SECRET || "";
	const config = JSON.parse((integration.config as string) || "{}");
	const { refresh_token, google_site_url } = config;

	if (!refresh_token || !google_site_url) {
		return c.json(
			{
				error: "Missing GSC credentials. Please re-authorize.",
				success: false,
			},
			400,
		);
	}

	// Refresh access token
	let accessToken: string;
	try {
		accessToken = await refreshAccessToken(refresh_token, clientId, clientSecret);
	} catch (err) {
		return c.json(
			{
				error: err instanceof Error ? err.message : "Token refresh failed",
				success: false,
			},
			401,
		);
	}

	// Sync last 7 days, querying day-by-day for proper date attribution
	// GSC data has a ~2-day delay, so we sync up to 2 days ago
	const effectiveEnd = new Date(Date.now() - 2 * 86400000);
	const startDate = new Date(Date.now() - 9 * 86400000); // 9 days ago to get 7 full days of data

	let synced = 0;
	try {
		// Query each day individually for proper date attribution
		for (let d = new Date(startDate); d <= effectiveEnd; d.setDate(d.getDate() + 1)) {
			const dateStr = d.toISOString().split("T")[0] ?? "";

			const result = await fetchSearchAnalytics(accessToken, google_site_url, dateStr, dateStr);
			const rows = result.rows || [];

			for (const row of rows) {
				const query = row.keys[0] || "";

				// Upsert: check existing, then insert or update
				const existing = await db
					.selectFrom("search_console_data")
					.select(["id"])
					.where("site_id", "=", siteId)
					.where("date", "=", dateStr)
					.where("query", "=", query)
					.executeTakeFirst();

				if (existing) {
					await db
						.updateTable("search_console_data")
						.set({
							clicks: row.clicks,
							impressions: row.impressions,
							ctr: row.ctr,
							position: row.position,
							fetched_at: new Date().toISOString(),
						})
						.where("id", "=", existing.id)
						.execute();
				} else {
					await db
						.insertInto("search_console_data")
						.values({
							id: generateId(),
							site_id: siteId,
							date: dateStr,
							query,
							clicks: row.clicks,
							impressions: row.impressions,
							ctr: row.ctr,
							position: row.position,
							fetched_at: new Date().toISOString(),
						})
						.execute();
				}
				synced++;
			}
		}
	} catch (err) {
		return c.json(
			{
				error: err instanceof Error ? err.message : "GSC sync failed",
				success: false,
			},
			502,
		);
	}

	// Update integration last_sync
	await db
		.updateTable("integrations")
		.set({ last_sync: new Date().toISOString() })
		.where("id", "=", integration.id)
		.execute();

	return c.json({ data: { synced }, success: true });
});
