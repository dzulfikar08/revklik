import { Hono } from "hono";
import type { WhoamiResponse } from "@revklik/shared";
import type { PublicApiEnv } from "../../middleware/public-auth";

export const v1WhoamiRoutes = new Hono<PublicApiEnv>();

v1WhoamiRoutes.get("/", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	const tokenScopes = c.get("tokenScopes");
	const tokenType = c.get("tokenType");
	const tokenSiteId = c.get("tokenSiteId");

	const [user, sub, apiKey] = await Promise.all([
		db
			.selectFrom("users")
			.select(["id", "name", "email"])
			.where("id", "=", userId)
			.executeTakeFirst(),
		db
			.selectFrom("subscriptions")
			.select(["plan"])
			.where("user_id", "=", userId)
			.executeTakeFirst(),
		db
			.selectFrom("api_keys")
			.select(["name", "created_at"])
			.where("user_id", "=", userId)
			.where("token_type", "=", tokenType)
			.where("scopes", "is not", null)
			.orderBy("created_at", "desc")
			.limit(1)
			.executeTakeFirst(),
	]);

	if (!user) {
		return c.json({ error: "User not found", success: false }, 404);
	}

	const response: WhoamiResponse = {
		user: { id: user.id, name: user.name, email: user.email },
		plan: sub?.plan ?? "free",
		token: {
			type: tokenType,
			scopes: tokenScopes,
			site_id: tokenSiteId,
			name: apiKey?.name ?? "unknown",
			created_at: apiKey?.created_at ?? new Date().toISOString(),
		},
	};

	return c.json({ data: response, success: true });
});
