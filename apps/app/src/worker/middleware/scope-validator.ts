import { createMiddleware } from "hono/factory";
import type { PublicApiEnv } from "./public-auth";

export function requireScope(scope: string) {
	return createMiddleware<PublicApiEnv>(async (c, next) => {
		const scopes = c.get("tokenScopes");
		if (!scopes?.includes(scope)) {
			return c.json(
				{
					error: "Insufficient scope",
					required: scope,
					success: false,
				},
				403,
			);
		}

		// For site tokens, validate site_id matches the requested site
		const tokenSiteId = c.get("tokenSiteId");
		if (tokenSiteId) {
			const requestedSiteId = c.req.query("site_id") || c.req.param("siteId");
			if (requestedSiteId && requestedSiteId !== tokenSiteId) {
				return c.json({ error: "Token not valid for this site", success: false }, 403);
			}
		}

		await next();
	});
}
