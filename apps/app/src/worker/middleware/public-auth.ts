import { createMiddleware } from "hono/factory";
import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { primeSiteInfo, type SiteInfo } from "../lib/public-api-queries";
import { sql } from "../db";
import type { RateLimitBindings } from "../lib/rate-limit";
import { hashToken } from "../utils";

type Bindings = RateLimitBindings & { DB: D1Database; FX_USD_IDR?: string; SELF_HOSTED?: string };
type Variables = {
	db: Kysely<KlikapaDatabase>;
	userId: string;
	tokenScopes: string[];
	tokenSiteId: string | null;
	/** api_keys row of the calling token: the rate-limit bucket key. */
	tokenId: string;
	tokenType: "account" | "site";
	/** Subscription plan read with the token; undefined when the caller must look it up. */
	plan?: string | null;
};
export type PublicApiEnv = { Bindings: Bindings; Variables: Variables };

export const publicAuthMiddleware = createMiddleware<PublicApiEnv>(async (c, next) => {
	const authHeader = c.req.header("Authorization");
	if (!authHeader?.startsWith("Bearer ")) {
		return c.json(
			{
				error: "Unauthorized. Provide a Bearer token (rvt_ or rv_)",
				success: false,
			},
			401,
		);
	}

	const token = authHeader.slice(7);
	if (!token.startsWith("rvt_") && !token.startsWith("rv_")) {
		return c.json(
			{
				error: "Invalid token type. Use an rvt_ account token or rv_ site token",
				success: false,
			},
			401,
		);
	}

	const db = c.get("db");
	if (!db) return c.json({ error: "Database unavailable", success: false }, 503);

	const keyHash = await hashToken(token);
	// One D1 round trip: the token (with its owner's plan, for the rate limiter)
	// and, when the request names a site, that site's row with the caller's access.
	const apiKeyQuery = db
		.selectFrom("api_keys")
		.leftJoin("subscriptions", "subscriptions.user_id", "api_keys.user_id")
		.select([
			"api_keys.id as id",
			"api_keys.user_id as user_id",
			"api_keys.token_type as token_type",
			"api_keys.scopes as scopes",
			"api_keys.site_id as site_id",
			"api_keys.expires_at as expires_at",
			"subscriptions.plan as plan",
		])
		.where("api_keys.key_hash", "=", keyHash)
		.limit(1);
	const requestedSite = c.req.query("site_id");
	const d1 = c.env?.DB;
	let apiKey: Awaited<ReturnType<typeof apiKeyQuery.executeTakeFirst>>;
	let siteRow: (SiteInfo & { allowed: number }) | undefined;
	if (d1 && requestedSite) {
		const keyStmt = apiKeyQuery.compile();
		const siteStmt = sql<SiteInfo & { allowed: number }>`
			SELECT s.id AS id, s.domain AS domain, s.revenue_currency AS revenue_currency,
				s.revenue_currency_source AS revenue_currency_source,
				(s.user_id = k.user_id OR EXISTS (
					SELECT 1 FROM team_members t
					WHERE t.site_id = s.id AND t.user_id = k.user_id AND t.accepted_at IS NOT NULL
				)) AS allowed
			FROM sites s JOIN api_keys k ON k.key_hash = ${keyHash}
			WHERE s.id = ${requestedSite}
			LIMIT 1`.compile(db);
		const [keyRes, siteRes] = await d1.batch([
			d1.prepare(keyStmt.sql).bind(...keyStmt.parameters),
			d1.prepare(siteStmt.sql).bind(...siteStmt.parameters),
		]);
		apiKey = (keyRes?.results?.[0] ?? undefined) as typeof apiKey;
		siteRow = siteRes?.results?.[0] as typeof siteRow;
	} else {
		apiKey = await apiKeyQuery.executeTakeFirst();
	}

	if (!apiKey) return c.json({ error: "Invalid token", success: false }, 401);

	// Validate token type matches prefix
	const prefixType = token.startsWith("rvt_") ? "account" : "site";
	if (apiKey.token_type !== prefixType) {
		return c.json({ error: "Token type mismatch", success: false }, 401);
	}

	// Check expiry
	if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) {
		return c.json({ error: "Token expired", success: false }, 401);
	}

	// Parse scopes
	let scopes: string[] = [];
	try {
		scopes = apiKey.scopes ? JSON.parse(apiKey.scopes) : [];
	} catch {
		scopes = [];
	}

	c.set("userId", apiKey.user_id);
	c.set("tokenScopes", scopes);
	c.set("tokenSiteId", apiKey.site_id);
	c.set("tokenId", apiKey.id);
	c.set("tokenType", apiKey.token_type as "account" | "site");
	c.set("plan", apiKey.plan ?? null);
	if (requestedSite && d1) {
		const { allowed, ...site } = siteRow ?? { allowed: 0 };
		primeSiteInfo(db, requestedSite, siteRow && allowed ? (site as SiteInfo) : null);
	}

	// Fire-and-forget update of last_used_at
	db.updateTable("api_keys")
		.set({ last_used_at: new Date().toISOString() })
		.where("id", "=", apiKey.id)
		.execute()
		.catch(() => {});

	await next();
});
