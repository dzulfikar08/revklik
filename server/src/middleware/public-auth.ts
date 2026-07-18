import { createMiddleware } from "hono/factory";
import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "shared";
import { hashToken } from "../utils";

type Bindings = { DB: D1Database };
type Variables = {
	db: Kysely<KlikapaDatabase>;
	userId: string;
	tokenScopes: string[];
	tokenSiteId: string | null;
	tokenType: "account" | "site";
};
export type PublicApiEnv = { Bindings: Bindings; Variables: Variables };

export const publicAuthMiddleware = createMiddleware<PublicApiEnv>(
	async (c, next) => {
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
					error:
						"Invalid token type. Use an rvt_ account token or rv_ site token",
					success: false,
				},
				401,
			);
		}

		const db = c.get("db");
		if (!db)
			return c.json({ error: "Database unavailable", success: false }, 503);

		const keyHash = await hashToken(token);
		const apiKey = await db
			.selectFrom("api_keys")
			.select([
				"id",
				"user_id",
				"token_type",
				"scopes",
				"site_id",
				"expires_at",
			])
			.where("key_hash", "=", keyHash)
			.executeTakeFirst();

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
		c.set("tokenType", apiKey.token_type as "account" | "site");

		// Fire-and-forget update of last_used_at
		db.updateTable("api_keys")
			.set({ last_used_at: new Date().toISOString() })
			.where("id", "=", apiKey.id)
			.execute()
			.catch(() => {});

		await next();
	},
);
