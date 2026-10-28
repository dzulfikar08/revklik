import { Hono } from "hono";
import type { Env } from "../types";
import { PortfolioQueryError, queryPortfolioRevenue } from "../lib/portfolio";

export const portfolioRoutes = new Hono<Env>();

// GET /revenue?from=&to=&currency= — same payload as GET /api/v1/portfolio/revenue
portfolioRoutes.get("/revenue", async (c) => {
	try {
		const data = await queryPortfolioRevenue(
			c.get("db"),
			c.get("userId"),
			{ from: c.req.query("from"), to: c.req.query("to"), currency: c.req.query("currency") },
			{ env: c.env },
		);
		return c.json({ data, success: true });
	} catch (e) {
		if (e instanceof PortfolioQueryError) return c.json({ error: e.message, success: false }, 400);
		throw e;
	}
});
