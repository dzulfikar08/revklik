import { Hono } from "hono";
import type { PublicApiEnv } from "../../middleware/public-auth";
import { createApiToken, listApiTokens, revokeApiToken } from "../../lib/token-service";
import { requireScope } from "../../middleware/scope-validator";

/** API-token token management. A token can only mint tokens weaker than itself. */
export const v1TokensRoutes = new Hono<PublicApiEnv>();

// GET / — List tokens for the user
v1TokensRoutes.get("/", requireScope("tokens:read"), async (c) => {
	return c.json({ data: await listApiTokens(c.get("db"), c.get("userId")), success: true });
});

// POST / — Create a new token
v1TokensRoutes.post("/", requireScope("tokens:write"), async (c) => {
	const body = await c.req.json().catch(() => ({}));
	const result = await createApiToken(
		c.get("db"),
		c.env,
		{
			userId: c.get("userId"),
			via: { scopes: c.get("tokenScopes"), type: c.get("tokenType") },
		},
		body,
	);
	if (!result.ok) return c.json({ error: result.error, success: false }, result.status);
	return c.json({ data: result.data, success: true }, 201);
});

// DELETE /:id — Revoke a token
v1TokensRoutes.delete("/:id", requireScope("tokens:write"), async (c) => {
	const result = await revokeApiToken(c.get("db"), c.get("userId"), c.req.param("id"));
	if (!result.ok) return c.json({ error: result.error, success: false }, result.status);
	return c.json({ data: result.data, success: true });
});
