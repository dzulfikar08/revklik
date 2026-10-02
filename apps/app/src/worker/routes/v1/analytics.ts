import { Hono } from "hono";
import type { PublicApiEnv } from "../../middleware/public-auth";
import { requireScope } from "../../middleware/scope-validator";
import {
	EXPORT_COLUMNS,
	eventsRowsForCsv,
	eventsRowsToJson,
	exportRows,
	publicApiCtx,
	publicApiErrorResponse,
	queryCampaigns,
	queryDevices,
	queryGeo,
	queryJourneys,
	queryOverview,
	queryTopPages,
	queryReferrers,
	queryRevenue,
	queryTimeseries,
	toCsv,
} from "../../lib/public-api-queries";

export const v1AnalyticsRoutes = new Hono<PublicApiEnv>();

type EventsRow = { props: string | null; [k: string]: unknown };

// GET /overview?site_id=&range=
v1AnalyticsRoutes.get("/overview", requireScope("analytics:read"), async (c) => {
	try {
		const data = await queryOverview(
			publicApiCtx(c),
			c.req.query("site_id"),
			c.req.query("range") || "7d",
		);
		return c.json({ data, success: true });
	} catch (e) {
		return publicApiErrorResponse(c, e);
	}
});

// GET /timeseries?site_id=&range=
v1AnalyticsRoutes.get("/timeseries", requireScope("analytics:read"), async (c) => {
	try {
		const data = await queryTimeseries(
			publicApiCtx(c),
			c.req.query("site_id"),
			c.req.query("range") || "7d",
		);
		return c.json({ data, success: true });
	} catch (e) {
		return publicApiErrorResponse(c, e);
	}
});

// GET /pages?site_id=&range=&limit=
v1AnalyticsRoutes.get("/pages", requireScope("analytics:read"), async (c) => {
	try {
		const limit = Math.min(Number(c.req.query("limit") || 10), 100);
		const data = await queryTopPages(
			publicApiCtx(c),
			c.req.query("site_id"),
			c.req.query("range") || "7d",
			limit,
		);
		return c.json({ data, success: true });
	} catch (e) {
		return publicApiErrorResponse(c, e);
	}
});

// GET /referrers?site_id=&range=&limit=
v1AnalyticsRoutes.get("/referrers", requireScope("analytics:read"), async (c) => {
	try {
		const limit = Math.min(Number(c.req.query("limit") || 10), 100);
		const data = await queryReferrers(
			publicApiCtx(c),
			c.req.query("site_id"),
			c.req.query("range") || "7d",
			limit,
		);
		return c.json({ data, success: true });
	} catch (e) {
		return publicApiErrorResponse(c, e);
	}
});

// GET /geo?site_id=&range=&limit=
v1AnalyticsRoutes.get("/geo", requireScope("analytics:read"), async (c) => {
	try {
		const limit = Math.min(Number(c.req.query("limit") || 50), 100);
		const data = await queryGeo(
			publicApiCtx(c),
			c.req.query("site_id"),
			c.req.query("range") || "7d",
			limit,
		);
		return c.json({ data, success: true });
	} catch (e) {
		return publicApiErrorResponse(c, e);
	}
});

// GET /devices?site_id=&range=
v1AnalyticsRoutes.get("/devices", requireScope("analytics:read"), async (c) => {
	try {
		const data = await queryDevices(
			publicApiCtx(c),
			c.req.query("site_id"),
			c.req.query("range") || "7d",
		);
		return c.json({ data, success: true });
	} catch (e) {
		return publicApiErrorResponse(c, e);
	}
});

// GET /revenue?site_id=&range=
v1AnalyticsRoutes.get("/revenue", requireScope("analytics:read"), async (c) => {
	try {
		const data = await queryRevenue(
			publicApiCtx(c),
			c.req.query("site_id"),
			c.req.query("range") || "7d",
		);
		return c.json({ data, success: true });
	} catch (e) {
		return publicApiErrorResponse(c, e);
	}
});

// GET /journeys?site_id=&range=&limit=&path=
v1AnalyticsRoutes.get("/journeys", requireScope("analytics:read"), async (c) => {
	try {
		const limit = Math.min(Number(c.req.query("limit") || 50), 100);
		const data = await queryJourneys(
			publicApiCtx(c),
			c.req.query("site_id"),
			c.req.query("range") || "7d",
			limit,
			c.req.query("path") || undefined,
		);
		return c.json({ data, success: true });
	} catch (e) {
		return publicApiErrorResponse(c, e);
	}
});

// GET /export?site_id=&range=&format=csv|json&type=events|visitors|sessions
v1AnalyticsRoutes.get("/export", requireScope("analytics:export"), async (c) => {
	const siteId = c.req.query("site_id");
	const format = c.req.query("format") || "csv";
	const type = (c.req.query("type") || "events") as "events" | "visitors" | "sessions";
	const range = c.req.query("range") || "30d";
	const eventType = c.req.query("event_type") || c.req.query("eventType") || "";
	const exportLimit = Math.min(Math.max(Number(c.req.query("limit")) || 10000, 1), 10000);

	try {
		const rows = await exportRows(publicApiCtx(c), siteId, range, {
			type,
			eventType,
			limit: exportLimit,
		});

		if (format === "json") {
			const data = type === "events" ? eventsRowsToJson(rows as EventsRow[]) : rows;
			return c.json({ data, success: true });
		}

		const csvRows =
			type === "events"
				? eventsRowsForCsv(rows as EventsRow[])
				: (rows as Record<string, unknown>[]);
		const csv = toCsv(csvRows, [...EXPORT_COLUMNS[type]]);
		return new Response(csv, {
			headers: {
				"Content-Type": "text/csv",
				"Content-Disposition": `attachment; filename="${type}-${siteId}-${range}.csv"`,
			},
		});
	} catch (e) {
		return publicApiErrorResponse(c, e);
	}
});

// GET /campaigns?site_id=&range=
v1AnalyticsRoutes.get("/campaigns", requireScope("analytics:read"), async (c) => {
	try {
		const data = await queryCampaigns(
			publicApiCtx(c),
			c.req.query("site_id"),
			c.req.query("range") || "7d",
		);
		return c.json({ data, success: true });
	} catch (e) {
		return publicApiErrorResponse(c, e);
	}
});
