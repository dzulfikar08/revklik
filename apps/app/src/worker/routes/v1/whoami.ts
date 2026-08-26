import { Hono } from "hono";
import type { PublicApiEnv } from "../../middleware/public-auth";
import { publicApiCtx, publicApiErrorResponse, queryWhoami } from "../../lib/public-api-queries";

export const v1WhoamiRoutes = new Hono<PublicApiEnv>();

v1WhoamiRoutes.get("/", async (c) => {
	try {
		const data = await queryWhoami(publicApiCtx(c));
		return c.json({ data, success: true });
	} catch (e) {
		return publicApiErrorResponse(c, e);
	}
});
