import { Hono } from "hono";
import type { PublicApiEnv } from "../../middleware/public-auth";
import { requireScope } from "../../middleware/scope-validator";
import {
	publicApiCtx,
	publicApiErrorResponse,
	querySite,
	querySites,
} from "../../lib/public-api-queries";

export const v1SitesRoutes = new Hono<PublicApiEnv>();

// GET / — List sites
v1SitesRoutes.get("/", requireScope("sites:read"), async (c) => {
	try {
		const data = await querySites(publicApiCtx(c));
		return c.json({ data, success: true });
	} catch (e) {
		return publicApiErrorResponse(c, e);
	}
});

// GET /:siteId — Get single site
v1SitesRoutes.get("/:siteId", requireScope("sites:read"), async (c) => {
	try {
		const data = await querySite(publicApiCtx(c), c.req.param("siteId"));
		return c.json({ data, success: true });
	} catch (e) {
		return publicApiErrorResponse(c, e);
	}
});
