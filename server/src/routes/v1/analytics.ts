import { Hono, type Context } from "hono";
import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "shared";
import { sql } from "../../db";
import type { PublicApiEnv } from "../../middleware/public-auth";
import { requireScope } from "../../middleware/scope-validator";
import { getDateRange } from "../../utils";

export const v1AnalyticsRoutes = new Hono<PublicApiEnv>();

const siteAccessCache = new Map<
	string,
	{ allowed: boolean; cachedAt: number }
>();
const SITE_ACCESS_TTL = 60_000;

async function validateSite(
	db: Kysely<KlikapaDatabase>,
	userId: string,
	siteId: string,
) {
	const key = `${userId}:${siteId}`;
	const cached = siteAccessCache.get(key);
	if (cached && Date.now() - cached.cachedAt < SITE_ACCESS_TTL)
		return cached.allowed;
	const result = await db
		.selectFrom("sites")
		.select(["id"])
		.where("id", "=", siteId)
		.where((eb) =>
			eb.or([
				eb("user_id", "=", userId),
				eb.exists(
					eb
						.selectFrom("team_members")
						.select("id")
						.where("site_id", "=", siteId)
						.where("user_id", "=", userId)
						.where("accepted_at", "is not", null),
				),
			]),
		)
		.executeTakeFirst();
	const allowed = !!result;
	siteAccessCache.set(key, { allowed, cachedAt: Date.now() });
	if (siteAccessCache.size > 1200) {
		const cutoff = Date.now() - SITE_ACCESS_TTL;
		for (const [k, v] of siteAccessCache) {
			if (v.cachedAt < cutoff) siteAccessCache.delete(k);
		}
	}
	return allowed;
}

function validateSiteAccess(
	c: Context<PublicApiEnv>,
	siteId: string,
): { valid: true; response: null } | { valid: false; response: Response } {
	const tokenSiteId = c.get("tokenSiteId");
	if (tokenSiteId && tokenSiteId !== siteId) {
		return {
			valid: false,
			response: c.json(
				{ error: "Token not valid for this site", success: false },
				403,
			),
		};
	}
	return { valid: true, response: null };
}

function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
	const esc = (v: unknown) => {
		const s = v === null || v === undefined ? "" : String(v);
		return s.includes(",") || s.includes('"') || s.includes("\n")
			? `"${s.replace(/"/g, '""')}"`
			: s;
	};
	return [
		columns.join(","),
		...rows.map((r) => columns.map((c) => esc(r[c])).join(",")),
	].join("\n");
}

// GET /overview?site_id=&range=
v1AnalyticsRoutes.get(
	"/overview",
	requireScope("analytics:read"),
	async (c) => {
		const db = c.get("db");
		const userId = c.get("userId");
		const siteId = c.req.query("site_id");
		const range = c.req.query("range") || "7d";

		if (!siteId)
			return c.json({ error: "site_id required", success: false }, 400);

		const siteCheck = validateSiteAccess(c, siteId);
		if (!siteCheck.valid) return siteCheck.response;

		if (!(await validateSite(db, userId, siteId)))
			return c.json({ error: "Site not found", success: false }, 404);

		const { start } = getDateRange(range);
		const startIso = start.toISOString();

		const [pv, vi, se, bo, rev, conv] = await Promise.all([
			db
				.selectFrom("events")
				.select(({ fn }) => [fn.count<number>("id").as("count")])
				.where("site_id", "=", siteId)
				.where("event_type", "=", "pageview")
				.where("timestamp", ">=", startIso)
				.executeTakeFirst(),
			db
				.selectFrom("events")
				.select(({ fn }) => [
					fn.count<number>("visitor_id").distinct().as("count"),
				])
				.where("site_id", "=", siteId)
				.where("timestamp", ">=", startIso)
				.executeTakeFirst(),
			db
				.selectFrom("sessions")
				.select(({ fn }) => [fn.count<number>("id").as("count")])
				.where("site_id", "=", siteId)
				.where("started_at", ">=", startIso)
				.executeTakeFirst(),
			db
				.selectFrom("sessions")
				.select(({ fn }) => [fn.avg<number>("is_bounce").as("avg")])
				.where("site_id", "=", siteId)
				.where("started_at", ">=", startIso)
				.executeTakeFirst(),
			db
				.selectFrom("events")
				.select(({ fn }) => [fn.sum<number>("revenue").as("total")])
				.where("site_id", "=", siteId)
				.where("revenue", ">", 0)
				.where("timestamp", ">=", startIso)
				.executeTakeFirst(),
			db
				.selectFrom("events")
				.select(({ fn }) => [fn.count<number>("id").as("count")])
				.where("site_id", "=", siteId)
				.where("event_type", "=", "conversion")
				.where("timestamp", ">=", startIso)
				.executeTakeFirst(),
		]);

		const data = {
			pageviews: Number(pv?.count ?? 0),
			visitors: Number(vi?.count ?? 0),
			sessions: Number(se?.count ?? 0),
			bounceRate: Math.round(Number(bo?.avg ?? 0) * 100),
			avgDuration: 0,
			revenue: Number(rev?.total ?? 0),
			conversions: Number(conv?.count ?? 0),
		};

		return c.json({ data, success: true });
	},
);

// GET /timeseries?site_id=&range=
v1AnalyticsRoutes.get(
	"/timeseries",
	requireScope("analytics:read"),
	async (c) => {
		const db = c.get("db");
		const userId = c.get("userId");
		const siteId = c.req.query("site_id");
		const range = c.req.query("range") || "7d";

		if (!siteId)
			return c.json({ error: "site_id required", success: false }, 400);

		const siteCheck = validateSiteAccess(c, siteId);
		if (!siteCheck.valid) return siteCheck.response;

		if (!(await validateSite(db, userId, siteId)))
			return c.json({ error: "Site not found", success: false }, 404);

		const { start, end } = getDateRange(range);
		const startIso = start.toISOString();
		const spanHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
		const isHourly = spanHours <= 48;
		const tsDate = isHourly
			? sql<string>`strftime('%Y-%m-%dT%H:00:00', ${sql.ref("timestamp")})`
			: sql<string>`date(${sql.ref("timestamp")})`;
		const tsGroup = isHourly
			? sql`strftime('%Y-%m-%dT%H:00:00', ${sql.ref("timestamp")})`
			: sql`date(${sql.ref("timestamp")})`;

		const rows = await db
			.selectFrom("events")
			.select([
				({ fn }) => fn.count<number>("id").as("pageviews"),
				({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors"),
				tsDate.as("date"),
			])
			.where("site_id", "=", siteId)
			.where("event_type", "=", "pageview")
			.where("timestamp", ">=", startIso)
			.groupBy(tsGroup)
			.orderBy("date", "asc")
			.execute();

		const data = rows.map((r) => ({
			date: String(r.date ?? ""),
			pageviews: Number(r.pageviews),
			visitors: Number(r.visitors),
		}));

		return c.json({ data, success: true });
	},
);

// GET /pages?site_id=&range=&limit=
v1AnalyticsRoutes.get("/pages", requireScope("analytics:read"), async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	const siteId = c.req.query("site_id");
	const range = c.req.query("range") || "7d";
	const limit = Math.min(Number(c.req.query("limit") || 10), 100);

	if (!siteId)
		return c.json({ error: "site_id required", success: false }, 400);

	const siteCheck = validateSiteAccess(c, siteId);
	if (!siteCheck.valid) return siteCheck.response;

	if (!(await validateSite(db, userId, siteId)))
		return c.json({ error: "Site not found", success: false }, 404);

	const { start } = getDateRange(range);
	const startIso = start.toISOString();

	const rows = await db
		.selectFrom("events")
		.select([
			"path",
			({ fn }) => fn.count<number>("id").as("pageviews"),
			({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors"),
		])
		.where("site_id", "=", siteId)
		.where("event_type", "=", "pageview")
		.where("timestamp", ">=", startIso)
		.groupBy("path")
		.orderBy("pageviews", "desc")
		.limit(limit)
		.execute();

	const data = rows.map((r) => ({
		path: r.path,
		pageviews: Number(r.pageviews),
		visitors: Number(r.visitors),
	}));

	return c.json({ data, success: true });
});

// GET /referrers?site_id=&range=&limit=
v1AnalyticsRoutes.get(
	"/referrers",
	requireScope("analytics:read"),
	async (c) => {
		const db = c.get("db");
		const userId = c.get("userId");
		const siteId = c.req.query("site_id");
		const range = c.req.query("range") || "7d";
		const limit = Math.min(Number(c.req.query("limit") || 10), 100);

		if (!siteId)
			return c.json({ error: "site_id required", success: false }, 400);

		const siteCheck = validateSiteAccess(c, siteId);
		if (!siteCheck.valid) return siteCheck.response;

		if (!(await validateSite(db, userId, siteId)))
			return c.json({ error: "Site not found", success: false }, 404);

		const { start } = getDateRange(range);
		const startIso = start.toISOString();

		const sourceExpr = sql<string>`COALESCE(utm_source,
    CASE WHEN referrer IS NULL OR referrer = '' THEN 'direct'
    ELSE LOWER(REPLACE(
      SUBSTR(SUBSTR(referrer, INSTR(referrer, '://') + 3), 1,
        INSTR(SUBSTR(referrer, INSTR(referrer, '://') + 3) || '/', '/') - 1),
      'www.', ''))
    END)`;

		const rows = await db
			.selectFrom("events")
			.select([
				sourceExpr.as("source"),
				({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors"),
			])
			.where("site_id", "=", siteId)
			.where("timestamp", ">=", startIso)
			.groupBy(sourceExpr)
			.orderBy("visitors", "desc")
			.limit(limit)
			.execute();

		const total = rows.reduce((s, r) => s + Number(r.visitors), 0);
		const data = rows.map((r) => ({
			source: String(r.source),
			visitors: Number(r.visitors),
			percentage:
				total > 0 ? Math.round((Number(r.visitors) / total) * 100) : 0,
		}));

		return c.json({ data, success: true });
	},
);

// GET /geo?site_id=&range=&limit=
v1AnalyticsRoutes.get("/geo", requireScope("analytics:read"), async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	const siteId = c.req.query("site_id");
	const range = c.req.query("range") || "7d";
	const limit = Math.min(Number(c.req.query("limit") || 50), 100);

	if (!siteId)
		return c.json({ error: "site_id required", success: false }, 400);

	const siteCheck = validateSiteAccess(c, siteId);
	if (!siteCheck.valid) return siteCheck.response;

	if (!(await validateSite(db, userId, siteId)))
		return c.json({ error: "Site not found", success: false }, 404);

	const { start } = getDateRange(range);
	const startIso = start.toISOString();

	const rows = await db
		.selectFrom("events")
		.select([
			"country",
			"region",
			"city",
			({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors"),
		])
		.where("site_id", "=", siteId)
		.where("timestamp", ">=", startIso)
		.groupBy(["country", "region", "city"])
		.orderBy("visitors", "desc")
		.limit(limit)
		.execute();

	return c.json({ data: rows, success: true });
});

// GET /devices?site_id=&range=
v1AnalyticsRoutes.get("/devices", requireScope("analytics:read"), async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	const siteId = c.req.query("site_id");
	const range = c.req.query("range") || "7d";

	if (!siteId)
		return c.json({ error: "site_id required", success: false }, 400);

	const siteCheck = validateSiteAccess(c, siteId);
	if (!siteCheck.valid) return siteCheck.response;

	if (!(await validateSite(db, userId, siteId)))
		return c.json({ error: "Site not found", success: false }, 404);

	const { start } = getDateRange(range);
	const startIso = start.toISOString();

	const [deviceRows, osRows, browserRows] = await Promise.all([
		db
			.selectFrom("sessions")
			.select([
				sql<string>`COALESCE(device_type, 'unknown')`.as("device"),
				({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors"),
			])
			.where("site_id", "=", siteId)
			.where("started_at", ">=", startIso)
			.groupBy("device_type")
			.orderBy("visitors", "desc")
			.limit(10)
			.execute(),
		db
			.selectFrom("sessions")
			.select([
				sql<string>`COALESCE(os, 'unknown')`.as("device"),
				({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors"),
			])
			.where("site_id", "=", siteId)
			.where("started_at", ">=", startIso)
			.groupBy("os")
			.orderBy("visitors", "desc")
			.limit(10)
			.execute(),
		db
			.selectFrom("sessions")
			.select([
				sql<string>`COALESCE(browser, 'unknown')`.as("device"),
				({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors"),
			])
			.where("site_id", "=", siteId)
			.where("started_at", ">=", startIso)
			.groupBy("browser")
			.orderBy("visitors", "desc")
			.limit(10)
			.execute(),
	]);

	const toEntries = (rows: typeof deviceRows) => {
		const total = rows.reduce((s, r) => s + Number(r.visitors), 0);
		return rows.map((r) => ({
			device: String(r.device),
			visitors: Number(r.visitors),
			percentage:
				total > 0 ? Math.round((Number(r.visitors) / total) * 100) : 0,
		}));
	};

	const data = {
		devices: toEntries(deviceRows),
		os: toEntries(osRows),
		browsers: toEntries(browserRows),
	};

	return c.json({ data, success: true });
});

// GET /revenue?site_id=&range=
v1AnalyticsRoutes.get("/revenue", requireScope("analytics:read"), async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	const siteId = c.req.query("site_id");
	const range = c.req.query("range") || "7d";

	if (!siteId)
		return c.json({ error: "site_id required", success: false }, 400);

	const siteCheck = validateSiteAccess(c, siteId);
	if (!siteCheck.valid) return siteCheck.response;

	if (!(await validateSite(db, userId, siteId)))
		return c.json({ error: "Site not found", success: false }, 404);

	const { start, end } = getDateRange(range);
	const startIso = start.toISOString();
	const spanHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
	const isHourly = spanHours <= 48;
	const tsDate = isHourly
		? sql<string>`strftime('%Y-%m-%dT%H:00:00', ${sql.ref("timestamp")})`
		: sql<string>`date(${sql.ref("timestamp")})`;
	const tsGroup = isHourly
		? sql`strftime('%Y-%m-%dT%H:00:00', ${sql.ref("timestamp")})`
		: sql`date(${sql.ref("timestamp")})`;

	const sourceExpr = sql<string>`COALESCE(utm_source,
    CASE WHEN referrer IS NULL OR referrer = '' THEN 'direct'
    ELSE LOWER(REPLACE(
      SUBSTR(SUBSTR(referrer, INSTR(referrer, '://') + 3), 1,
        INSTR(SUBSTR(referrer, INSTR(referrer, '://') + 3) || '/', '/') - 1),
      'www.', ''))
    END)`;

	const [revBySource, revByCountry, revTs] = await Promise.all([
		// Revenue by source
		db
			.selectFrom("events")
			.select([
				sourceExpr.as("source"),
				({ fn }) => fn.sum<number>("revenue").as("revenue"),
				({ fn }) => fn.count<number>("id").as("conversions"),
			])
			.where("site_id", "=", siteId)
			.where("revenue", ">", 0)
			.where("timestamp", ">=", startIso)
			.groupBy(sourceExpr)
			.orderBy("revenue", "desc")
			.limit(10)
			.execute(),
		// Revenue by country
		db
			.selectFrom("events")
			.select([
				sql<string>`COALESCE(country, 'unknown')`.as("country"),
				({ fn }) => fn.sum<number>("revenue").as("revenue"),
				({ fn }) => fn.count<number>("id").as("conversions"),
			])
			.where("site_id", "=", siteId)
			.where("revenue", ">", 0)
			.where("timestamp", ">=", startIso)
			.groupBy("country")
			.orderBy("revenue", "desc")
			.limit(10)
			.execute(),
		// Revenue timeseries
		db
			.selectFrom("events")
			.select([
				tsDate.as("date"),
				({ fn }) => fn.sum<number>("revenue").as("revenue"),
				({ fn }) => fn.count<number>("id").as("conversions"),
			])
			.where("site_id", "=", siteId)
			.where("revenue", ">", 0)
			.where("timestamp", ">=", startIso)
			.groupBy(tsGroup)
			.orderBy("date", "asc")
			.execute(),
	]);

	const data = {
		bySource: revBySource.map((r) => ({
			source: String(r.source),
			revenue: Number(r.revenue ?? 0),
			conversions: Number(r.conversions ?? 0),
		})),
		byCountry: revByCountry.map((r) => ({
			country: String(r.country),
			revenue: Number(r.revenue ?? 0),
			conversions: Number(r.conversions ?? 0),
		})),
		timeseries: revTs.map((r) => ({
			date: String(r.date ?? ""),
			revenue: Number(r.revenue ?? 0),
			conversions: Number(r.conversions ?? 0),
		})),
	};

	return c.json({ data, success: true });
});

// GET /journeys?site_id=&range=&limit=
v1AnalyticsRoutes.get(
	"/journeys",
	requireScope("analytics:read"),
	async (c) => {
		const db = c.get("db");
		const userId = c.get("userId");
		const siteId = c.req.query("site_id");
		const range = c.req.query("range") || "7d";
		const limit = Math.min(Number(c.req.query("limit") || 50), 100);

		if (!siteId)
			return c.json({ error: "site_id required", success: false }, 400);

		const siteCheck = validateSiteAccess(c, siteId);
		if (!siteCheck.valid) return siteCheck.response;

		if (!(await validateSite(db, userId, siteId)))
			return c.json({ error: "Site not found", success: false }, 404);

		const { start } = getDateRange(range);
		const startIso = start.toISOString();

		const [recentSessions, profiles] = await Promise.all([
			db
				.selectFrom("sessions")
				.select([
					"id",
					"visitor_id",
					"started_at",
					"country",
					"region",
					"city",
					"device_type",
					"browser",
					"os",
					"utm_source",
					"referrer",
				])
				.where("site_id", "=", siteId)
				.where("started_at", ">=", startIso)
				.orderBy("started_at", "desc")
				.limit(limit)
				.execute(),
			db
				.selectFrom("visitor_profiles")
				.select(["visitor_id", "name", "email"])
				.where("site_id", "=", siteId)
				.orderBy("last_seen", "desc")
				.limit(50)
				.execute(),
		]);

		const sessionIds = recentSessions.map((s) => s.id);
		const BATCH = 50;
		const allSessionEvents: {
			session_id: string;
			path: string;
			event_type: string;
			name: string | null;
			timestamp: string;
			revenue: number | null;
			props: string | null;
		}[] = [];
		const batches: string[][] = [];
		for (let i = 0; i < sessionIds.length; i += BATCH) {
			batches.push(sessionIds.slice(i, i + BATCH));
		}
		const batchResults = await Promise.all(
			batches.map((batch) =>
				db
					.selectFrom("events")
					.select([
						"session_id",
						"path",
						"event_type",
						"name",
						"timestamp",
						"revenue",
						"props",
					])
					.where("session_id", "in", batch)
					.where("site_id", "=", siteId)
					.orderBy("timestamp", "asc")
					.execute(),
			),
		);
		for (const rows of batchResults) allSessionEvents.push(...rows);
		const eventsBySession = new Map<string, typeof allSessionEvents>();
		for (const e of allSessionEvents) {
			if (!eventsBySession.has(e.session_id))
				eventsBySession.set(e.session_id, []);
			eventsBySession.get(e.session_id)?.push(e);
		}

		const data = recentSessions.map((sess) => {
			const events = eventsBySession.get(sess.id) ?? [];
			const profile = profiles.find((p) => p.visitor_id === sess.visitor_id);
			return {
				session_id: sess.id,
				visitor_id: sess.visitor_id,
				visitor_name: profile?.name ?? null,
				visitor_email: profile?.email ?? null,
				country: sess.country ?? null,
				region: sess.region ?? null,
				city: sess.city ?? null,
				device_type: sess.device_type ?? null,
				browser: sess.browser ?? null,
				os: sess.os ?? null,
				utm_source: sess.utm_source ?? null,
				referrer: sess.referrer ?? null,
				started_at: sess.started_at,
				steps: events.map((e) => ({
					path: e.path,
					event_type: e.event_type,
					name: e.name,
					timestamp: e.timestamp,
					revenue: e.revenue,
					props: e.props,
				})),
				total_revenue: events.reduce((s, e) => s + Number(e.revenue ?? 0), 0),
				is_identified: !!(profile?.name || profile?.email),
			};
		});

		return c.json({ data, success: true });
	},
);

// GET /export?site_id=&range=&format=csv|json&type=events|visitors|sessions
v1AnalyticsRoutes.get(
	"/export",
	requireScope("analytics:export"),
	async (c) => {
		const db = c.get("db");
		const userId = c.get("userId");
		const siteId = c.req.query("site_id");
		const format = c.req.query("format") || "csv";
		const type = c.req.query("type") || "events";
		const range = c.req.query("range") || "30d";
		const eventType =
			c.req.query("event_type") || c.req.query("eventType") || "";
		const exportLimit = Math.min(
			Math.max(Number(c.req.query("limit")) || 10000, 1),
			10000,
		);

		if (!siteId)
			return c.json({ error: "site_id required", success: false }, 400);

		const siteCheck = validateSiteAccess(c, siteId);
		if (!siteCheck.valid) return siteCheck.response;

		if (!(await validateSite(db, userId, siteId)))
			return c.json({ error: "Site not found", success: false }, 404);

		const { start } = getDateRange(range);
		const startIso = start.toISOString();

		if (type === "visitors") {
			const rows = await db
				.selectFrom("visitor_profiles")
				.select([
					"visitor_id",
					"name",
					"email",
					"country",
					"region",
					"city",
					"device_type",
					"browser",
					"os",
					"total_sessions",
					"total_pageviews",
					"total_revenue",
					"first_seen",
					"last_seen",
				])
				.where("site_id", "=", siteId)
				.orderBy("last_seen", "desc")
				.limit(10000)
				.execute();

			if (format === "json") {
				return c.json({ data: rows, success: true });
			}
			const csv = toCsv(rows as unknown as Record<string, unknown>[], [
				"visitor_id",
				"name",
				"email",
				"country",
				"region",
				"city",
				"device_type",
				"browser",
				"os",
				"total_sessions",
				"total_pageviews",
				"total_revenue",
				"first_seen",
				"last_seen",
			]);
			return new Response(csv, {
				headers: {
					"Content-Type": "text/csv",
					"Content-Disposition": `attachment; filename="visitors-${siteId}-${range}.csv"`,
				},
			});
		}

		if (type === "sessions") {
			const rows = await db
				.selectFrom("sessions")
				.select([
					"id",
					"visitor_id",
					"entry_path",
					"exit_path",
					"referrer",
					"utm_source",
					"utm_medium",
					"utm_campaign",
					"country",
					"city",
					"device_type",
					"browser",
					"page_count",
					"is_bounce",
					"started_at",
					"ended_at",
				])
				.where("site_id", "=", siteId)
				.where("started_at", ">=", startIso)
				.orderBy("started_at", "desc")
				.limit(10000)
				.execute();

			if (format === "json") {
				return c.json({ data: rows, success: true });
			}
			const csv = toCsv(rows as unknown as Record<string, unknown>[], [
				"id",
				"visitor_id",
				"entry_path",
				"exit_path",
				"referrer",
				"utm_source",
				"utm_medium",
				"utm_campaign",
				"country",
				"city",
				"device_type",
				"browser",
				"page_count",
				"is_bounce",
				"started_at",
				"ended_at",
			]);
			return new Response(csv, {
				headers: {
					"Content-Type": "text/csv",
					"Content-Disposition": `attachment; filename="sessions-${siteId}-${range}.csv"`,
				},
			});
		}

		// Default: events (server-side event_type filter + limit — avoids shipping 10k rows)
		let eventsQuery = db
			.selectFrom("events")
			.select([
				"id",
				"visitor_id",
				"session_id",
				"event_type",
				"name",
				"path",
				"hostname",
				"referrer",
				"utm_source",
				"utm_medium",
				"utm_campaign",
				"country",
				"region",
				"city",
				"device_type",
				"browser",
				"os",
				"revenue",
				"timestamp",
			])
			.where("site_id", "=", siteId)
			.where("timestamp", ">=", startIso);
		if (eventType)
			eventsQuery = eventsQuery.where("event_type", "=", eventType as never);
		const rows = await eventsQuery
			.orderBy("timestamp", "desc")
			.limit(exportLimit)
			.execute();

		if (format === "json") {
			return c.json({ data: rows, success: true });
		}
		const csv = toCsv(rows as unknown as Record<string, unknown>[], [
			"id",
			"visitor_id",
			"session_id",
			"event_type",
			"name",
			"path",
			"hostname",
			"referrer",
			"utm_source",
			"utm_medium",
			"utm_campaign",
			"country",
			"region",
			"city",
			"device_type",
			"browser",
			"os",
			"revenue",
			"timestamp",
		]);
		return new Response(csv, {
			headers: {
				"Content-Type": "text/csv",
				"Content-Disposition": `attachment; filename="events-${siteId}-${range}.csv"`,
			},
		});
	},
);

// GET /campaigns?site_id=&range=
v1AnalyticsRoutes.get(
	"/campaigns",
	requireScope("analytics:read"),
	async (c) => {
		const db = c.get("db");
		const userId = c.get("userId");
		const siteId = c.req.query("site_id");
		const range = c.req.query("range") || "7d";

		if (!siteId)
			return c.json({ error: "site_id required", success: false }, 400);

		const siteCheck = validateSiteAccess(c, siteId);
		if (!siteCheck.valid) return siteCheck.response;

		if (!(await validateSite(db, userId, siteId)))
			return c.json({ error: "Site not found", success: false }, 404);

		const { start } = getDateRange(range);
		const startIso = start.toISOString();

		const rows = await db
			.selectFrom("events")
			.select([
				"utm_source",
				"utm_medium",
				"utm_campaign",
				sql<string>`count(distinct visitor_id)`.as("visitors"),
				sql<string>`sum(case when event_type = 'pageview' then 1 else 0 end)`.as(
					"pageviews",
				),
				sql<string>`sum(case when event_type = 'conversion' then 1 else 0 end)`.as(
					"conversions",
				),
				sql<string>`coalesce(sum(revenue), 0)`.as("revenue"),
			])
			.where("site_id", "=", siteId)
			.where("timestamp", ">=", startIso)
			.where("utm_source", "is not", null)
			.groupBy(["utm_source", "utm_medium", "utm_campaign"])
			.orderBy(sql`count(distinct visitor_id)`, "desc")
			.limit(50)
			.execute();

		const data = rows.map((r) => ({
			utm_source: r.utm_source ?? "(direct)",
			utm_medium: r.utm_medium ?? "(none)",
			utm_campaign: r.utm_campaign ?? "(none)",
			visitors: Number(r.visitors),
			pageviews: Number(r.pageviews),
			conversions: Number(r.conversions),
			revenue: Number(r.revenue),
			conversionRate:
				Number(r.visitors) > 0
					? Math.round((Number(r.conversions) / Number(r.visitors)) * 10000) /
						100
					: 0,
		}));

		return c.json({ data, success: true });
	},
);
