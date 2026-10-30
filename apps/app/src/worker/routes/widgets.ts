import { Hono } from "hono";
import type { Kysely } from "kysely";
import { SCOPES, type KlikapaDatabase } from "@revklik/shared";
import { dayBucketSql, pageviewsSql, visitorsSql } from "../lib/metrics";
import { authenticateApiToken } from "../lib/token-auth";

type Variables = { db: Kysely<KlikapaDatabase> };
export const widgetRoutes = new Hono<{ Variables: Variables }>();

// GET /api/widget-data — returns lightweight stats for home screen widgets
// Authenticated via api_key query param (not Bearer header)
widgetRoutes.get("/", async (c) => {
	const db = c.get("db");
	const apiKey = c.req.query("api_key");
	const siteId = c.req.query("site_id");

	if (!apiKey || !siteId) {
		return c.json({ error: "api_key and site_id required", success: false }, 400);
	}

	// Session tokens (kp_) are never accepted in a URL: they leak into logs and referrers.
	// Use an rv_ site token (or rvt_ account token) with the analytics:read scope.
	const auth = await authenticateApiToken(db, apiKey, {
		scope: SCOPES.ANALYTICS_READ,
		siteId,
		action: "read",
	});
	if (!auth.ok) return c.json({ error: auth.error, success: false }, auth.status);
	const site = await db
		.selectFrom("sites")
		.select(["name"])
		.where("id", "=", siteId)
		.executeTakeFirst();
	if (!site) return c.json({ error: "Site not found", success: false }, 404);

	const now = new Date();
	const start7d = new Date(now.getTime() - 7 * 86400000).toISOString();
	const start14d = new Date(now.getTime() - 14 * 86400000).toISOString();

	// Current period stats
	const [stats, trendRow, sparkRows] = await Promise.all([
		db
			.selectFrom("events")
			.select([pageviewsSql().as("pageviews"), visitorsSql().as("visitors")])
			.where("site_id", "=", siteId)
			.where("timestamp", ">=", start7d)
			.executeTakeFirst(),
		db
			.selectFrom("events")
			.select(visitorsSql().as("count"))
			.where("site_id", "=", siteId)
			.where("timestamp", ">=", start14d)
			.where("timestamp", "<", start7d)
			.executeTakeFirst(),
		db
			.selectFrom("events")
			.select(visitorsSql().as("v"))
			.where("site_id", "=", siteId)
			.where("timestamp", ">=", start7d)
			.groupBy(dayBucketSql(0))
			.orderBy(dayBucketSql(0))
			.execute(),
	]);

	const visitors = Number(stats?.visitors ?? 0);
	const pageviews = Number(stats?.pageviews ?? 0);
	const prevVisitors = Number(trendRow?.count ?? 0);
	const trend = prevVisitors > 0 ? Math.round(((visitors - prevVisitors) / prevVisitors) * 100) : 0;
	const sparkline = sparkRows.map((r) => Number(r.v));

	return c.json({
		data: {
			siteName: site.name,
			visitors,
			pageviews,
			trend,
			sparkline,
			updatedAt: now.toISOString(),
		},
		success: true,
	});
});
