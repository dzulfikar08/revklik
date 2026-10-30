import { Hono } from "hono";
import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { createApiToken, listApiTokens, revokeApiToken } from "../lib/token-service";

type Variables = { db: Kysely<KlikapaDatabase>; userId: string };
type TokensEnv = { Variables: Variables; Bindings: { DB: D1Database; SELF_HOSTED?: string } };

/** Dashboard (session) token management. The /v1/tokens routes share the same service. */
export const tokenRoutes = new Hono<TokensEnv>();

// GET / — list tokens (masked)
tokenRoutes.get("/", async (c) => {
	return c.json({ data: await listApiTokens(c.get("db"), c.get("userId")), success: true });
});

// POST / — create token
tokenRoutes.post("/", async (c) => {
	const body = await c.req.json().catch(() => ({}));
	const result = await createApiToken(c.get("db"), c.env, { userId: c.get("userId") }, body);
	if (!result.ok) return c.json({ error: result.error, success: false }, result.status);
	return c.json({ data: result.data, success: true }, 201);
});

// DELETE /:id — revoke token
tokenRoutes.delete("/:id", async (c) => {
	const result = await revokeApiToken(c.get("db"), c.get("userId"), c.req.param("id"));
	if (!result.ok) return c.json({ error: result.error, success: false }, result.status);
	return c.json({ data: result.data, success: true });
});
