import { Hono } from "hono";
import { SCOPES } from "@revklik/shared";
import type { PublicApiEnv } from "../../middleware/public-auth";
import { requireScope } from "../../middleware/scope-validator";
import { PublicApiError, publicApiCtx, publicApiErrorResponse } from "../../lib/public-api-queries";
import { PortfolioQueryError, queryPortfolioRevenue } from "../../lib/portfolio";

export const v1PortfolioRoutes = new Hono<PublicApiEnv>();

// GET /revenue?from=YYYY-MM-DD&to=YYYY-MM-DD&currency=IDR
v1PortfolioRoutes.get("/revenue", requireScope(SCOPES.ANALYTICS_READ), async (c) => {
	try {
		const ctx = publicApiCtx(c);
		const data = await queryPortfolioRevenue(
			ctx.db,
			ctx.userId,
			{ from: c.req.query("from"), to: c.req.query("to"), currency: c.req.query("currency") },
			{ env: ctx.env, onlySiteId: ctx.tokenSiteId },
		).catch((e: unknown) => {
			if (e instanceof PortfolioQueryError) throw new PublicApiError(400, e.message);
			throw e;
		});
		return c.json({ data, success: true });
	} catch (e) {
		return publicApiErrorResponse(c, e);
	}
});
