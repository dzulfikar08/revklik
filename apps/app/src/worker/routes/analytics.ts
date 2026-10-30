import { Hono, type Context } from "hono";
import type { Kysely } from "kysely";
import type {
	CrawlerSlot,
	CrawlersResponse,
	KlikapaDatabase,
	RecordingDetail,
	RecordingSummary,
	SiteDashboard,
	VisitorJourney,
} from "@revklik/shared";
import { sql } from "../db";
import type { FunnelStep } from "../lib/analytics-queries";
import {
	applyFilters,
	buildDepthSteps,
	buildFunnelSteps,
	buildHeatmapData,
	parseFilters,
	processScrollEvents,
	toCsv,
	validateSite,
} from "../lib/analytics-queries";
import { planRequiredBody } from "../lib/plan-gate";
import { isSelfHosted } from "../lib/entitlement";
import { requirePlanForSite } from "../lib/plans";
import {
	executePlan,
	loadDashboardData,
	loadJourneyData,
	planGeo,
	queryPlan,
	runBatch,
	type SessionEvent,
	type SessionSummary,
} from "../queries/analytics";
import { canonicalSource } from "../lib/source-sql";
import {
	conversionsSql,
	isHourlyRange,
	pageviewsSql,
	pctChange,
	previousWindowStart,
	revenueTotalSql,
	visitorsSql,
} from "../lib/metrics";
import { requireSiteAccess } from "../lib/site-access";
import { resolveQueryScope } from "../lib/site-scope";
import { getDateRange } from "../utils";

type Variables = { db: Kysely<KlikapaDatabase>; userId: string; retentionFloor?: string };
type AnalyticsEnv = {
	Variables: Variables;
	Bindings: { DB: D1Database; FX_USD_IDR?: string; SELF_HOSTED?: string };
};

export const analyticsRoutes = new Hono<AnalyticsEnv>();

/** getDateRange with the start clamped to the plan's retention window. */
function rangeFor(c: Context<AnalyticsEnv>, range: string): { start: Date; end: Date } {
	const r = getDateRange(range);
	const floor = c.get("retentionFloor");
	if (floor && r.start.getTime() < Date.parse(floor)) r.start = new Date(floor);
	return r;
}

type AnalyticsHandler = (c: Context<AnalyticsEnv>) => Promise<Response>;

const CACHE_TTL_SECONDS = 60;

/**
 * Edge cache for aggregate read endpoints — one dashboard load scans every
 * event in the range a dozen times, and reloads re-pay it all. Keyed per user
 * so analytics never leak across accounts; the client response stays no-store
 * while the edge copy absorbs repeat loads for TTL seconds. Live data
 * (/stream) and exports are never cached.
 */
const edgeCache =
	(handler: AnalyticsHandler): AnalyticsHandler =>
	async (c) => {
		const url = new URL(c.req.url);
		// Per-user key component MUST live in the query string: Cache API strips
		// URL fragments (#...) when matching, which would share one cached
		// dashboard across every account.
		const userKey = url.search ? `${url.search}&u=${c.get("userId")}` : `?u=${c.get("userId")}`;
		const cacheKey = new Request(`https://edge-cache.klikapa.internal${url.pathname}${userKey}`);
		const cache = caches.default;
		const hit = await cache.match(cacheKey);
		if (hit) {
			// A hit skips the handler, so re-check access here (memoized per
			// request) — a revoked team member must not read the cached copy.
			const siteId = c.req.query("site_id");
			if (!(siteId && (await validateSite(c.get("db"), c.get("userId"), siteId)))) {
				return c.json({ error: "Site not found", success: false }, 404);
			}
			return new Response(hit.body, {
				headers: {
					"Content-Type": "application/json; charset=utf-8",
					"Cache-Control": "private, max-age=60",
					"X-Cache": "HIT",
				},
			});
		}
		const res = await handler(c);
		if (res.status !== 200) return res;
		const body = await res.arrayBuffer();
		c.executionCtx.waitUntil(
			cache.put(
				cacheKey,
				new Response(body, {
					headers: {
						"Content-Type": "application/json; charset=utf-8",
						"Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}`,
					},
				}),
			),
		);
		return new Response(body, {
			headers: {
				"Content-Type": "application/json; charset=utf-8",
				"Cache-Control": "private, no-store",
				"X-Cache": "MISS",
			},
		});
	};

analyticsRoutes.get(
	"/dashboard",
	edgeCache(async (c) => {
		const db = c.get("db");
		const userId = c.get("userId");
		const siteId = c.req.query("site_id");
		const range = c.req.query("range") || "7d";
		const filtersParam = c.req.query("filters") || "";
		const filters = parseFilters(filtersParam);
		if (!siteId) return c.json({ error: "site_id required", success: false }, 400);
		const site = await validateSite(db, userId, siteId);
		if (!site) return c.json({ error: "Site not found", success: false }, 404);

		const scope = await resolveQueryScope(db, siteId, c.env, c.req.query("tz"));
		const { start, end } = rangeFor(c, range);
		const startIso = start.toISOString();
		const endIso = end.toISOString();
		const isHourly = isHourlyRange(start, end);
		// The previous window is never clamped to the plan floor: the plan limits
		// how far back charts reach, not whether a delta has a baseline.
		const prevStartIso = previousWindowStart(start, end);

		const {
			stats,
			prevStats,
			timeseries,
			prevTimeseries,
			topPages,
			sources,
			devices,
			os,
			browsers,
			recentSessions,
			profiles,
			revenueBySource,
			revenueByCountry,
			revenueTimeseries,
			entryPagesRevenue,
			exitPages,
			revenueByMethod,
			revenueByProvider,
			channels,
		} = await loadDashboardData(c.env.DB, db, {
			siteId,
			siteDomain: site.domain,
			window: { prevStartIso, startIso, endIso },
			isHourly,
			filters,
			scope,
		});

		// Period-over-period comparison (current range vs the equal window before it)
		const metric = (cur: number, prev: number) => ({
			current: cur,
			previous: prev,
			changePct: pctChange(cur, prev),
		});
		const compare: SiteDashboard["compare"] = {
			pageviews: metric(stats.pageviews, prevStats.pageviews),
			visitors: metric(stats.visitors, prevStats.visitors),
			sessions: metric(stats.sessions, prevStats.sessions),
			bounceRate: metric(stats.bounceRate, prevStats.bounceRate),
			avgDuration: metric(stats.avgDuration, prevStats.avgDuration),
			revenue: metric(stats.revenue, prevStats.revenue),
			conversions: metric(stats.conversions, prevStats.conversions),
			netRevenue: metric(stats.netRevenue ?? 0, prevStats.netRevenue ?? 0),
		};

		// The users list ignores the range, so a profile whose sessions fall outside
		// it (or beyond the newest-100 window) would join to zero journeys and render
		// as "0 events". Backfill each uncovered profile with its latest session that
		// has at least one non-heartbeat event — index-backed, and chunked under D1's
		// bound-parameter cap (see getLatestSessionsForVisitors).
		const journeyVisitors = new Set(recentSessions.map((s) => s.visitor_id));
		const missingVisitors = profiles
			.map((p) => p.visitor_id)
			.filter((id) => !journeyVisitors.has(id));
		const { backfillSessions, eventsBySession } = await loadJourneyData(
			c.env.DB,
			db,
			siteId,
			recentSessions,
			missingVisitors,
		);

		const toJourney = (sess: SessionSummary, events: SessionEvent[]): VisitorJourney => {
			const profile = profiles.find((p) => p.visitor_id === sess.visitor_id);
			return {
				session_id: sess.id,
				visitor_id: sess.visitor_id,
				visitor_name: profile?.name ?? null,
				visitor_email: profile?.email ?? null,
				country: sess.country ?? profile?.country ?? null,
				region: sess.region ?? profile?.region ?? null,
				city: sess.city ?? profile?.city ?? null,
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
		};

		// Newest sessions first (feeds the Journeys tab), then one latest-session
		// journey per otherwise-uncovered profile (feeds the Users tab).
		const journeys: VisitorJourney[] = recentSessions.map((sess) =>
			toJourney(sess, eventsBySession.get(sess.id) ?? []),
		);
		for (const sess of backfillSessions) {
			journeys.push(toJourney(sess, eventsBySession.get(sess.id) ?? []));
		}

		const dashboard: SiteDashboard = {
			stats,
			compare,
			timeseries,
			prev_timeseries: prevTimeseries,
			topPages,
			sources,
			devices,
			os,
			browsers,
			journeys,
			revenueBySource,
			revenueByCountry,
			revenueTimeseries,
			entryPagesRevenue,
			exitPages,
			revenueByMethod,
			revenueByProvider,
			channels,
			currency: scope.money.currency,
		};
		return c.json({ data: dashboard, currency: scope.money.currency, success: true });
	}),
);

analyticsRoutes.get(
	"/sparkline",
	edgeCache(async (c) => {
		const db = c.get("db");
		const userId = c.get("userId");
		const siteId = c.req.query("site_id");
		if (!siteId) return c.json({ error: "site_id required", success: false }, 400);
		const site = await validateSite(db, userId, siteId);
		if (!site) return c.json({ error: "Site not found", success: false }, 404);

		const tsDay = sql`date(${sql.ref("timestamp")})`;
		const startIso = new Date(Date.now() - 7 * 86_400_000).toISOString();
		const rows = await db
			.selectFrom("events")
			.select([({ fn }) => fn.count<number>("id").as("count"), tsDay.as("day")])
			.where("site_id", "=", siteId)
			.where("event_type", "=", "pageview")
			.where("timestamp", ">=", startIso)
			.groupBy(tsDay)
			.orderBy("day", "asc")
			.execute();

		// Zero-fill 7 continuous days — position-based sparkline needs fixed length
		const byDay = new Map(rows.map((r) => [String(r.day ?? ""), Number(r.count)]));
		const data: number[] = [];
		for (let t = new Date(startIso).getTime(); t < Date.now(); t += 86_400_000) {
			data.push(byDay.get(new Date(t).toISOString().slice(0, 10)) ?? 0);
		}
		return c.json({ data, success: true });
	}),
);

analyticsRoutes.get(
	"/funnel",
	edgeCache(async (c) => {
		const db = c.get("db");
		const userId = c.get("userId");
		const siteId = c.req.query("site_id");
		const range = c.req.query("range") || "7d";
		if (!siteId) return c.json({ error: "site_id required", success: false }, 400);
		const site = await validateSite(db, userId, siteId);
		if (!site) return c.json({ error: "Site not found", success: false }, 404);

		const { start } = rangeFor(c, range);
		const startIso = start.toISOString();

		const [totalVisitors, scrollEvents, pageVisCounts] = await runBatch(c.env.DB, [
			// Total unique visitors (funnel entry = all pageview visitors)
			queryPlan(
				db
					.selectFrom("events")
					.select(visitorsSql().as("count"))
					.where("site_id", "=", siteId)
					.where("timestamp", ">=", startIso),
				(rows) => rows[0],
			),
			// Scroll-related events with their page path. Repeats of the same
			// visitor/section/depth add nothing to the visitor sets, so the database
			// collapses them instead of shipping every row.
			queryPlan(
				db
					.selectFrom("events")
					.select(["visitor_id", "name", "props", "path"])
					.distinct()
					.where("site_id", "=", siteId)
					.where("name", "in", ["scroll", "scroll_section"])
					.where("timestamp", ">=", startIso),
				(rows) => rows,
			),
			// Pageview visitors per page: each page funnel's entry count
			queryPlan(
				db
					.selectFrom("events")
					.select(["path", ({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors")])
					.where("site_id", "=", siteId)
					.where("event_type", "=", "pageview")
					.where("timestamp", ">=", startIso)
					.groupBy("path")
					.orderBy("visitors", "desc")
					.limit(50),
				(rows) => rows,
			),
		]);

		// Per-page tracking: path -> section -> visitor set
		const { pageSectionVisitors, sectionVisitors, visitorDepths } =
			processScrollEvents(scrollEvents);

		const total = Number(totalVisitors?.count ?? 0);

		// Build global funnel
		let steps: FunnelStep[] = [];
		if (sectionVisitors.size > 0) {
			steps = buildFunnelSteps(sectionVisitors, total);
		} else {
			steps = buildDepthSteps(visitorDepths, total);
		}

		const convRate =
			steps.length >= 2 && total > 0
				? Math.round(((steps[steps.length - 1]?.visitors ?? 0) / total) * 1000) / 10
				: 0;

		const pageVisMap = new Map(pageVisCounts.map((r) => [r.path, Number(r.visitors)]));

		const pages = [...pageSectionVisitors.entries()]
			.map(([path, secMap]) => {
				const pageTotal = pageVisMap.get(path) ?? 0;
				const pageSteps = buildFunnelSteps(secMap, pageTotal);
				const pageConvRate =
					pageSteps.length >= 2 && pageTotal > 0
						? Math.round(((pageSteps[pageSteps.length - 1]?.visitors ?? 0) / pageTotal) * 1000) / 10
						: 0;
				return {
					path,
					steps: pageSteps,
					totalVisitors: pageTotal,
					conversionRate: pageConvRate,
				};
			})
			.filter((p) => p.steps.length > 0)
			.sort((a, b) => b.totalVisitors - a.totalVisitors);

		return c.json({
			data: { steps, totalVisitors: total, conversionRate: convRate, pages },
			success: true,
		});
	}),
);

analyticsRoutes.get("/visitors", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	const siteId = c.req.query("site_id");
	if (!siteId) return c.json({ error: "site_id required", success: false }, 400);
	const site = await validateSite(db, userId, siteId);
	if (!site) return c.json({ error: "Site not found", success: false }, 404);
	const visitors = await db
		.selectFrom("visitor_profiles")
		.select([
			"id",
			"visitor_id",
			"name",
			"email",
			"phone",
			"first_seen",
			"last_seen",
			"country",
			"region",
			"city",
			"device_type",
			"browser",
			"os",
			"total_sessions",
			"total_pageviews",
			"total_revenue",
			"tags",
			"notes",
		])
		.where("site_id", "=", siteId)
		.orderBy("last_seen", "desc")
		.limit(100)
		.execute();

	return c.json({ data: visitors, success: true });
});

// Single visitor: profile + recent journeys (deep-links, e.g. prediction panels).
analyticsRoutes.get("/visitors/:visitorId", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	const visitorId = c.req.param("visitorId");
	const siteId = c.req.query("site_id");
	if (!siteId) return c.json({ error: "site_id required", success: false }, 400);
	const site = await validateSite(db, userId, siteId);
	if (!site) return c.json({ error: "Site not found", success: false }, 404);

	const profile = await db
		.selectFrom("visitor_profiles")
		.select([
			"id",
			"visitor_id",
			"name",
			"email",
			"phone",
			"first_seen",
			"last_seen",
			"country",
			"region",
			"city",
			"device_type",
			"browser",
			"os",
			"total_sessions",
			"total_pageviews",
			"total_revenue",
			"tags",
			"notes",
		])
		.where("visitor_id", "=", visitorId)
		.where("site_id", "=", siteId)
		.executeTakeFirst();
	if (!profile) return c.json({ error: "Not found", success: false }, 404);

	const { start } = rangeFor(c, c.req.query("range") ?? "7d");
	const startIso = start.toISOString();
	const sessions = await db
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
			"page_count",
		])
		.where("site_id", "=", siteId)
		.where("visitor_id", "=", visitorId)
		.where("started_at", ">=", startIso)
		.orderBy("started_at", "desc")
		.limit(20)
		.execute();

	const sessionIds = sessions.map((s) => s.id);
	const events = sessionIds.length
		? await db
				.selectFrom("events")
				.select(["session_id", "path", "event_type", "name", "timestamp", "revenue", "props"])
				.where("session_id", "in", sessionIds)
				.where("site_id", "=", siteId)
				.orderBy("timestamp", "asc")
				.execute()
		: [];
	const eventsBySession = new Map<string, typeof events>();
	for (const e of events) {
		if (!eventsBySession.has(e.session_id)) eventsBySession.set(e.session_id, []);
		eventsBySession.get(e.session_id)?.push(e);
	}

	const journeys = sessions.map((sess) => {
		const sessEvents = eventsBySession.get(sess.id) ?? [];
		return {
			session_id: sess.id,
			visitor_id: sess.visitor_id,
			visitor_name: profile.name ?? null,
			visitor_email: profile.email ?? null,
			country: sess.country ?? profile.country ?? null,
			region: sess.region ?? profile.region ?? null,
			city: sess.city ?? profile.city ?? null,
			device_type: sess.device_type ?? null,
			browser: sess.browser ?? null,
			os: sess.os ?? null,
			utm_source: sess.utm_source ?? null,
			referrer: sess.referrer ?? null,
			started_at: sess.started_at,
			steps: sessEvents.map((e) => ({
				path: e.path,
				event_type: e.event_type,
				name: e.name,
				timestamp: e.timestamp,
				revenue: e.revenue,
				props: e.props,
			})),
			total_revenue: sessEvents.reduce((s, e) => s + Number(e.revenue ?? 0), 0),
			is_identified: !!(profile.name || profile.email),
		};
	});

	return c.json({ data: { profile, journeys }, success: true });
});

analyticsRoutes.patch("/visitors/:visitorId", async (c) => {
	const db = c.get("db");
	const profileId = c.req.param("visitorId");
	const body = await c.req.json();

	// The dashboard addresses a profile by its row id.
	const profile = await db
		.selectFrom("visitor_profiles")
		.select(["id", "site_id"])
		.where("id", "=", profileId)
		.executeTakeFirst();
	if (!profile) return c.json({ error: "Not found", success: false }, 404);

	const access = await requireSiteAccess(c, profile.site_id, "write");
	if (access instanceof Response) return access;
	const updates: Record<string, unknown> = {};
	if (body.name !== undefined) updates.name = body.name;
	if (body.email !== undefined) updates.email = body.email;
	if (body.phone !== undefined) updates.phone = body.phone;
	if (body.tags !== undefined) updates.tags = body.tags;
	if (body.notes !== undefined) updates.notes = body.notes;

	if (Object.keys(updates).length > 0) {
		await db
			.updateTable("visitor_profiles")
			.set(updates)
			.where("id", "=", profile.id)
			.where("site_id", "=", profile.site_id)
			.execute();
	}

	return c.json({ success: true });
});

analyticsRoutes.get(
	"/geo",
	edgeCache(async (c) => {
		const db = c.get("db");
		const userId = c.get("userId");
		const siteId = c.req.query("site_id");
		const range = c.req.query("range") || "7d";
		const filtersParam = c.req.query("filters") || "";
		const filters = parseFilters(filtersParam);
		if (!siteId) return c.json({ error: "site_id required", success: false }, 400);
		const site = await validateSite(db, userId, siteId);
		if (!site) return c.json({ error: "Site not found", success: false }, 404);
		const { start, end } = rangeFor(c, range);
		const rows = await executePlan(
			db,
			planGeo(db, siteId, start.toISOString(), 50, filters, end.toISOString()),
		);

		return c.json({ data: rows, success: true });
	}),
);

// Campaign performance: visitors/pageviews/conversions/revenue grouped by
// UTM source + medium + campaign (dashboard shape of GET /v1/analytics/campaigns)
analyticsRoutes.get(
	"/campaigns",
	edgeCache(async (c) => {
		const db = c.get("db");
		const userId = c.get("userId");
		const siteId = c.req.query("site_id");
		const range = c.req.query("range") || "7d";
		const filtersParam = c.req.query("filters") || "";
		const filters = parseFilters(filtersParam);
		if (!siteId) return c.json({ error: "site_id required", success: false }, 400);
		const site = await validateSite(db, userId, siteId);
		if (!site) return c.json({ error: "Site not found", success: false }, 404);
		const { start, end } = rangeFor(c, range);
		const startIso = start.toISOString();
		const endIso = end.toISOString();
		const scope = await resolveQueryScope(db, siteId, c.env, c.req.query("tz"));

		const rows = await applyFilters(
			db
				.selectFrom("events")
				.select([
					canonicalSource(sql.ref("utm_source")).as("utm_source"),
					"utm_medium",
					"utm_campaign",
					visitorsSql().as("visitors"),
					pageviewsSql().as("pageviews"),
					conversionsSql().as("conversions"),
					revenueTotalSql(scope.money).as("revenue"),
				])
				.where("site_id", "=", siteId)
				.where("timestamp", ">=", startIso)
				.where("timestamp", "<", endIso),
			filters,
		)
			.groupBy([canonicalSource(sql.ref("utm_source")), "utm_medium", "utm_campaign"])
			.orderBy("visitors", "desc")
			.limit(50)
			.execute();

		return c.json({
			data: rows.map((r) => ({
				utm_source: r.utm_source ?? "(direct)",
				utm_medium: r.utm_medium ?? "(none)",
				utm_campaign: r.utm_campaign ?? "(none)",
				visitors: Number(r.visitors),
				pageviews: Number(r.pageviews),
				conversions: Number(r.conversions),
				revenue: Number(r.revenue),
				conversionRate:
					Number(r.visitors) > 0
						? Math.round((Number(r.conversions) / Number(r.visitors)) * 10000) / 100
						: 0,
			})),
			currency: scope.money.currency,
			success: true,
		});
	}),
);

// Heatmap analytics (Growth plan only)
analyticsRoutes.get(
	"/heatmap",
	edgeCache(async (c) => {
		const db = c.get("db");
		const userId = c.get("userId");
		const siteId = c.req.query("site_id");
		const path = c.req.query("path") || "/";
		const range = c.req.query("range") || "7d";
		if (!siteId) return c.json({ error: "site_id required", success: false }, 400);
		const site = await validateSite(db, userId, siteId);
		if (!site) return c.json({ error: "Site not found", success: false }, 404);

		const planCheck = await requirePlanForSite(db, userId, siteId, 2, isSelfHosted(c.env));
		if (!planCheck.allowed) return c.json(planRequiredBody("growth", planCheck.plan), 403);

		const { start } = rangeFor(c, range);
		const startIso = start.toISOString();

		const [clickRows, scrollRows, sessionCount] = await Promise.all([
			db
				.selectFrom("heatmap_clicks")
				.select(["x", "y", "element_selector", "element_text", "visitor_id"])
				.where("site_id", "=", siteId)
				.where("path", "=", path)
				.where("timestamp", ">=", startIso)
				.limit(5000)
				.execute(),
			db
				.selectFrom("heatmap_scrolls")
				.select(["max_scroll", "visitor_id"])
				.where("site_id", "=", siteId)
				.where("path", "=", path)
				.where("timestamp", ">=", startIso)
				.limit(5000)
				.execute(),
			db
				.selectFrom("heatmap_clicks")
				.select(({ fn }) => [fn.count<string>("visitor_id").distinct().as("cnt")])
				.where("site_id", "=", siteId)
				.where("path", "=", path)
				.where("timestamp", ">=", startIso)
				.executeTakeFirst(),
		]);

		const heatmapData = buildHeatmapData(clickRows, scrollRows, Number(sessionCount?.cnt ?? 0));

		return c.json({ data: heatmapData, success: true });
	}),
);

// List session recordings (Growth plan only)
analyticsRoutes.get("/recordings", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	const siteId = c.req.query("site_id");
	const range = c.req.query("range") || "7d";
	if (!siteId) return c.json({ error: "site_id required", success: false }, 400);
	const site = await validateSite(db, userId, siteId);
	if (!site) return c.json({ error: "Site not found", success: false }, 404);

	const planCheck = await requirePlanForSite(db, userId, siteId, 2, isSelfHosted(c.env));
	if (!planCheck.allowed) return c.json(planRequiredBody("growth", planCheck.plan), 403);

	const { start } = rangeFor(c, range);
	const startIso = start.toISOString();

	const rows = await db
		.selectFrom("session_recordings")
		.select(["id", "session_id", "path", "duration", "viewport_width", "started_at", "events"])
		.where("site_id", "=", siteId)
		.where("started_at", ">=", startIso)
		.orderBy("started_at", "desc")
		.limit(50)
		.execute();

	const recordings: RecordingSummary[] = rows.map((r) => {
		let eventCount = 0;
		try {
			const evts = JSON.parse(r.events || "[]");
			eventCount = Array.isArray(evts) ? evts.length : 0;
		} catch {
			/* ignore */
		}
		return {
			id: r.id,
			session_id: r.session_id,
			path: r.path,
			duration: r.duration,
			viewport_width: r.viewport_width,
			started_at: r.started_at,
			event_count: eventCount,
			has_revenue: false,
		};
	});

	return c.json({ data: recordings, success: true });
});

// Get single recording (Growth plan only)
analyticsRoutes.get("/recordings/:id", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	const recordingId = c.req.param("id");

	const row = await db
		.selectFrom("session_recordings")
		.selectAll()
		.where("id", "=", recordingId)
		.executeTakeFirst();
	if (!row) return c.json({ error: "Recording not found", success: false }, 404);

	const site = await validateSite(db, userId, row.site_id);
	if (!site) return c.json({ error: "Not found", success: false }, 404);

	const planCheck = await requirePlanForSite(db, userId, row.site_id, 2, isSelfHosted(c.env));
	if (!planCheck.allowed) return c.json(planRequiredBody("growth", planCheck.plan), 403);

	let events: Array<{
		t: number;
		type: "mutation" | "interaction" | "scroll" | "resize";
		d: unknown;
	}> = [];
	try {
		events = JSON.parse(row.events);
	} catch {
		events = [];
	}

	// Map compact event types to full names
	const typeMap: Record<string, "mutation" | "interaction" | "scroll" | "resize"> = {
		m: "mutation",
		c: "interaction",
		s: "scroll",
		r: "resize",
	};
	const mappedEvents = events.map((e) => ({
		t: e.t,
		type: typeMap[e.type as string] ?? "interaction",
		d: e.d,
	}));

	const eventCount = mappedEvents.length;

	const detail: RecordingDetail = {
		id: row.id,
		session_id: row.session_id,
		path: row.path,
		duration: row.duration,
		viewport_width: row.viewport_width,
		started_at: row.started_at,
		event_count: eventCount,
		has_revenue: false,
		events: mappedEvents,
		viewport_height: row.viewport_height,
	};

	return c.json({ data: detail, success: true });
});

// SSE endpoint for real-time visitor updates
analyticsRoutes.get("/stream", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	const siteId = c.req.query("site_id");
	if (!siteId) return c.json({ error: "site_id required", success: false }, 400);

	const site = await validateSite(db, userId, siteId);
	if (!site) return c.json({ error: "Site not found", success: false }, 404);

	const d1 = c.env.DB;
	const signal = c.req.raw.signal;

	const MAX_POLLS = 10;
	const POLL_MS = 2500;
	// The online count is recomputed on every 3rd poll (and on the poll after
	// new events arrive) instead of every poll; the last value is what clients
	// keep anyway.
	const COUNT_EVERY = 3;

	let timer: ReturnType<typeof setTimeout> | undefined;
	let closed = false;

	const stream = new ReadableStream({
		start(controller) {
			const encoder = new TextEncoder();

			const stop = () => {
				closed = true;
				clearTimeout(timer);
				timer = undefined;
				signal?.removeEventListener("abort", finish);
			};
			function finish() {
				stop();
				try {
					controller.close();
				} catch {}
			}

			const send = (event: string, data: unknown) => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
				} catch {
					stop();
				}
			};

			if (signal?.aborted) {
				finish();
				return;
			}
			signal?.addEventListener("abort", finish);

			send("connected", { site_id: siteId, ts: Date.now() });

			let lastTs = new Date().toISOString();
			let iterations = 0;
			let countPending = false;

			const poll = async () => {
				if (closed) return;
				if (iterations >= MAX_POLLS) {
					send("close", { reason: "timeout" });
					finish();
					return;
				}
				iterations++;
				const countDue = countPending || (iterations - 1) % COUNT_EVERY === 0;

				try {
					const eventsPlan = queryPlan(
						db
							.selectFrom("events")
							.select([
								"id",
								"visitor_id",
								"event_type",
								"name",
								"path",
								"timestamp",
								"country",
								"city",
								"device_type",
								"browser",
							])
							.where("site_id", "=", siteId)
							.where("timestamp", ">", lastTs)
							.orderBy("timestamp", "asc")
							.limit(50),
						(rows) => rows,
					);
					const countPlan = queryPlan(
						db
							.selectFrom("events")
							.select(({ fn }) => fn.count<number>("visitor_id").distinct().as("count"))
							.where("site_id", "=", siteId)
							.where("timestamp", ">", new Date(Date.now() - 5 * 60_000).toISOString()),
						(rows) => rows[0]?.count ?? 0,
					);
					const [events, liveCount] = countDue
						? await runBatch(d1, [eventsPlan, countPlan])
						: [...(await runBatch(d1, [eventsPlan])), undefined];

					if (closed) return;

					for (const ev of events) {
						send("visitor", ev);
					}
					if (events.length > 0) {
						lastTs = events[events.length - 1]?.timestamp ?? lastTs;
					}
					if (liveCount !== undefined) {
						countPending = false;
						send("stats", { live_visitors: liveCount });
					} else if (events.length > 0) {
						countPending = true;
					}
				} catch {
					/* ignore poll errors */
				}

				if (!closed) timer = setTimeout(poll, POLL_MS);
			};

			timer = setTimeout(poll, 1000);
		},
		cancel() {
			closed = true;
			clearTimeout(timer);
			timer = undefined;
		},
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no",
		},
	});
});

// Data export endpoint (CSV or JSON)
analyticsRoutes.get("/export", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	const siteId = c.req.query("site_id");
	const format = c.req.query("format") || "csv";
	const type = c.req.query("type") || "events";
	const range = c.req.query("range") || "30d";
	const eventType = c.req.query("event_type") || c.req.query("eventType") || "";
	const exportLimit = Math.min(Math.max(Number(c.req.query("limit")) || 10000, 1), 10000);

	if (!siteId) return c.json({ error: "site_id required", success: false }, 400);
	const site = await validateSite(db, userId, siteId);
	if (!site) return c.json({ error: "Site not found", success: false }, 404);

	const { start } = rangeFor(c, range);
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
		const csv = toCsv(rows, [
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
		const csv = toCsv(rows, [
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
		eventsQuery = eventsQuery.where(
			"event_type",
			"=",
			eventType as "pageview" | "custom" | "conversion" | "payment" | "subscription",
		);
	const rows = await eventsQuery.orderBy("timestamp", "desc").limit(exportLimit).execute();

	if (format === "json") {
		return c.json({ data: rows, success: true });
	}
	const csv = toCsv(rows, [
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
});

// AI crawler traffic for the Crawlers panel: category totals, per-bot
// breakdown, and a continuous hourly/daily series. Source is crawler_hits —
// bots recorded at /api/track instead of being dropped (see track.ts).
analyticsRoutes.get(
	"/crawlers",
	edgeCache(async (c) => {
		const db = c.get("db");
		const userId = c.get("userId");
		const siteId = c.req.query("site_id");
		const range = c.req.query("range") || "7d";
		if (!siteId) return c.json({ error: "site_id required", success: false }, 400);
		const site = await validateSite(db, userId, siteId);
		if (!site) return c.json({ error: "Site not found", success: false }, 404);

		const { start, end } = rangeFor(c, range);
		const startIso = start.toISOString();
		const endIso = end.toISOString();
		const isHourly = (end.getTime() - start.getTime()) / 3_600_000 <= 48;
		const bucket = isHourly
			? sql<string>`strftime('%Y-%m-%dT%H:00:00', ${sql.ref("timestamp")})`
			: sql<string>`date(${sql.ref("timestamp")})`;

		const inRange = () =>
			db
				.selectFrom("crawler_hits")
				.where("site_id", "=", siteId)
				.where("timestamp", ">=", startIso)
				.where("timestamp", "<", endIso);

		const [catRows, botRows, seriesRows] = await Promise.all([
			inRange()
				.select(["category", ({ fn }) => fn.count<number>("id").as("count")])
				.groupBy("category")
				.execute(),
			inRange()
				.select(["bot", "category", ({ fn }) => fn.count<number>("id").as("count")])
				.groupBy(["bot", "category"])
				.orderBy("count", "desc")
				.execute(),
			inRange()
				.select([bucket.as("date"), "category", ({ fn }) => fn.count<number>("id").as("count")])
				.groupBy([bucket, "category"])
				.orderBy("date", "asc")
				.execute(),
		]);

		const totals = { all: 0, ai_answers: 0, indexing: 0, training: 0, other: 0 };
		for (const r of catRows) {
			const n = Number(r.count);
			totals[r.category] = n;
			totals.all += n;
		}

		// Fill gaps so the chart gets one bucket per key, matching /dashboard series
		const slotByDate: Record<string, CrawlerSlot> = {};
		for (const r of seriesRows) {
			slotByDate[String(r.date)] ??= {
				date: String(r.date),
				ai_answers: 0,
				indexing: 0,
				training: 0,
				other: 0,
			};
			slotByDate[String(r.date)][r.category] = Number(r.count);
		}
		const stepMs = isHourly ? 3_600_000 : 86_400_000;
		const startMs = new Date(startIso).getTime();
		const endMs = Math.min(end.getTime(), Date.now());
		const series: CrawlerSlot[] = [];
		for (let t = startMs; t <= endMs; t += stepMs) {
			const key = isHourly
				? new Date(t).toISOString().slice(0, 13) + ":00:00"
				: new Date(t).toISOString().slice(0, 10);
			series.push(
				slotByDate[key] ?? { date: key, ai_answers: 0, indexing: 0, training: 0, other: 0 },
			);
		}
		return c.json({
			data: {
				totals,
				bots: botRows.map((r) => ({ bot: r.bot, category: r.category, count: Number(r.count) })),
				series,
			} satisfies CrawlersResponse,
			success: true,
		});
	}),
);
