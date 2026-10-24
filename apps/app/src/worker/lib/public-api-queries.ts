import type { Context } from "hono";
import type { Kysely } from "kysely";
import type { KlikapaDatabase, WhoamiResponse } from "@revklik/shared";
import { sql } from "../db";
import type { PublicApiEnv } from "../middleware/public-auth";
import { getDateRange } from "../utils";
import { type MoneyContext, revenueSql } from "./fx";
import { resolveQueryScope } from "./site-scope";
import { toCsv } from "./analytics-queries";
import { avgSessionSecondsSql } from "./session-duration";
import { canonicalSource, externalReferrerOnly, sourceSql } from "./source-sql";

/**
 * Shared query layer for the public API. Consumed by both the v1 REST routes
 * (routes/v1/*) and the MCP server (routes/mcp/*) so the two surfaces cannot
 * drift apart.
 *
 * Guard order inside each query preserves the original v1 error precedence:
 * 400 (missing site_id) -> 403 (token/site mismatch) -> 404 (site not found).
 * Scope checks stay at the route/tool layer.
 */

export interface PublicApiCtx {
	db: Kysely<KlikapaDatabase>;
	/** Bindings that tune revenue conversion (FX_USD_IDR). */
	env?: { FX_USD_IDR?: string };
	userId: string;
	tokenScopes: string[];
	tokenSiteId: string | null;
	tokenType: "account" | "site";
}

export class PublicApiError extends Error {
	constructor(
		readonly status: 400 | 403 | 404,
		message: string,
		readonly hint?: string,
	) {
		super(message);
	}
}

/** Build a PublicApiCtx from the variables set by publicAuthMiddleware. */
export function publicApiCtx(c: Context<PublicApiEnv>): PublicApiCtx {
	return {
		db: c.get("db"),
		env: c.env,
		userId: c.get("userId"),
		tokenScopes: c.get("tokenScopes"),
		tokenSiteId: c.get("tokenSiteId"),
		tokenType: c.get("tokenType"),
	};
}

/** Map PublicApiError to the v1 error envelope; rethrow anything else. */
export function publicApiErrorResponse(c: Context<PublicApiEnv>, e: unknown): Response {
	if (e instanceof PublicApiError) {
		return c.json({ error: e.message, success: false }, e.status);
	}
	throw e;
}

// --- Guards ---

export function requireScopeOn(ctx: PublicApiCtx, scope: string): void {
	if (!ctx.tokenScopes.includes(scope)) {
		throw new PublicApiError(403, `Insufficient scope: ${scope} required`);
	}
}

function requireSiteId(siteId: string | undefined): string {
	if (!siteId) throw new PublicApiError(400, "site_id required");
	return siteId;
}

export function assertSiteAllowed(ctx: PublicApiCtx, siteId: string): void {
	if (ctx.tokenSiteId && ctx.tokenSiteId !== siteId) {
		throw new PublicApiError(403, "Token not valid for this site");
	}
}

const siteAccessCache = new Map<string, { allowed: boolean; cachedAt: number }>();
const SITE_ACCESS_TTL = 60_000;

async function validateSite(db: Kysely<KlikapaDatabase>, userId: string, siteId: string) {
	const key = `${userId}:${siteId}`;
	const cached = siteAccessCache.get(key);
	if (cached && Date.now() - cached.cachedAt < SITE_ACCESS_TTL) return cached.allowed;
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

export async function assertSiteExists(ctx: PublicApiCtx, siteId: string): Promise<void> {
	if (!(await validateSite(ctx.db, ctx.userId, siteId))) {
		throw new PublicApiError(404, "Site not found");
	}
}

/** The site's revenue currency and today's rates: every revenue sum converts into it. */
async function moneyFor(ctx: PublicApiCtx, siteId: string): Promise<MoneyContext> {
	return (await resolveQueryScope(ctx.db, siteId, ctx.env, undefined)).money;
}

// Guard trio applied by every site-scoped analytics query.
async function guardSite(ctx: PublicApiCtx, siteId: string | undefined): Promise<string> {
	const id = requireSiteId(siteId);
	assertSiteAllowed(ctx, id);
	await assertSiteExists(ctx, id);
	return id;
}

// --- Shared SQL fragments ---

function tsFragments(range: string) {
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
	return { start, end, startIso, isHourly, tsDate, tsGroup };
}

// --- Whoami ---

export async function queryWhoami(ctx: PublicApiCtx): Promise<WhoamiResponse> {
	const { db, userId } = ctx;

	const [user, sub, apiKey] = await Promise.all([
		db
			.selectFrom("users")
			.select(["id", "name", "email"])
			.where("id", "=", userId)
			.executeTakeFirst(),
		db
			.selectFrom("subscriptions")
			.select(["plan"])
			.where("user_id", "=", userId)
			.executeTakeFirst(),
		db
			.selectFrom("api_keys")
			.select(["name", "created_at"])
			.where("user_id", "=", userId)
			.where("token_type", "=", ctx.tokenType)
			.where("scopes", "is not", null)
			.orderBy("created_at", "desc")
			.limit(1)
			.executeTakeFirst(),
	]);

	if (!user) {
		throw new PublicApiError(404, "User not found");
	}

	return {
		user: { id: user.id, name: user.name, email: user.email },
		plan: sub?.plan ?? "free",
		token: {
			type: ctx.tokenType,
			scopes: ctx.tokenScopes,
			site_id: ctx.tokenSiteId,
			name: apiKey?.name ?? "unknown",
			created_at: apiKey?.created_at ?? new Date().toISOString(),
		},
	};
}

// --- Sites ---

export async function querySites(ctx: PublicApiCtx) {
	const { db, userId } = ctx;

	// For site tokens, only return the bound site
	if (ctx.tokenSiteId) {
		if (!(await validateSite(db, userId, ctx.tokenSiteId))) {
			throw new PublicApiError(404, "Site not found");
		}
		return db
			.selectFrom("sites")
			.select(["id", "name", "domain", "created_at"])
			.where("id", "=", ctx.tokenSiteId)
			.execute();
	}

	// For account tokens, return all user sites (owned + team)
	return db
		.selectFrom("sites")
		.select(["id", "name", "domain", "created_at"])
		.where((eb) =>
			eb.or([
				eb("user_id", "=", userId),
				eb.exists(
					eb
						.selectFrom("team_members")
						.select("id")
						.whereRef("site_id", "=", "sites.id")
						.where("user_id", "=", userId)
						.where("accepted_at", "is not", null),
				),
			]),
		)
		.orderBy("created_at", "desc")
		.execute();
}

export async function querySite(ctx: PublicApiCtx, siteId: string) {
	assertSiteAllowed(ctx, siteId);
	if (!(await validateSite(ctx.db, ctx.userId, siteId))) {
		throw new PublicApiError(404, "Site not found");
	}
	return ctx.db
		.selectFrom("sites")
		.select(["id", "name", "domain", "created_at"])
		.where("id", "=", siteId)
		.executeTakeFirst();
}

// --- Analytics ---

export async function queryOverview(ctx: PublicApiCtx, siteId: string | undefined, range: string) {
	const db = ctx.db;
	const id = await guardSite(ctx, siteId);

	const { start } = getDateRange(range);
	const startIso = start.toISOString();
	const money = await moneyFor(ctx, id);

	const [pv, vi, se, bo, du, rev, conv] = await Promise.all([
		db
			.selectFrom("events")
			.select(({ fn }) => [fn.count<number>("id").as("count")])
			.where("site_id", "=", id)
			.where("event_type", "=", "pageview")
			.where("timestamp", ">=", startIso)
			.executeTakeFirst(),
		db
			.selectFrom("events")
			.select(() => [
				// Server-reported sales (external_id) belong to a buyer, not a site visit.
				sql<number>`COUNT(DISTINCT CASE WHEN external_id IS NULL THEN visitor_id END)`.as("count"),
			])
			.where("site_id", "=", id)
			.where("timestamp", ">=", startIso)
			.executeTakeFirst(),
		db
			.selectFrom("sessions")
			.select(({ fn }) => [fn.count<number>("id").as("count")])
			.where("site_id", "=", id)
			.where("started_at", ">=", startIso)
			.executeTakeFirst(),
		db
			.selectFrom("sessions")
			.select(({ fn }) => [fn.avg<number>("is_bounce").as("avg")])
			.where("site_id", "=", id)
			.where("started_at", ">=", startIso)
			.executeTakeFirst(),
		// Session duration: same formula as the dashboard rollup
		// (queries/analytics.ts) — sessions with ≥2 events carry ended_at.
		db
			.selectFrom("sessions")
			.select(() => [avgSessionSecondsSql.as("avg_duration")])
			.where("site_id", "=", id)
			.where("started_at", ">=", startIso)
			.executeTakeFirst(),
		db
			.selectFrom("events")
			.select(() => [sql<number>`SUM(${revenueSql(money)})`.as("total")])
			.where("site_id", "=", id)
			.where("revenue", "!=", 0)
			.where("timestamp", ">=", startIso)
			.executeTakeFirst(),
		db
			.selectFrom("events")
			.select(({ fn }) => [fn.count<number>("id").as("count")])
			.where("site_id", "=", id)
			.where("event_type", "=", "conversion")
			.where("timestamp", ">=", startIso)
			.executeTakeFirst(),
	]);

	return {
		pageviews: Number(pv?.count ?? 0),
		visitors: Number(vi?.count ?? 0),
		sessions: Number(se?.count ?? 0),
		bounceRate: Math.round(Number(bo?.avg ?? 0) * 100),
		avgDuration: Math.round(Number(du?.avg_duration ?? 0)),
		revenue: Number(rev?.total ?? 0),
		currency: money.currency,
		conversions: Number(conv?.count ?? 0),
	};
}

export async function queryTimeseries(
	ctx: PublicApiCtx,
	siteId: string | undefined,
	range: string,
) {
	const db = ctx.db;
	const id = await guardSite(ctx, siteId);

	const { startIso, tsDate, tsGroup } = tsFragments(range);

	const rows = await db
		.selectFrom("events")
		.select([
			({ fn }) => fn.count<number>("id").as("pageviews"),
			({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors"),
			tsDate.as("date"),
		])
		.where("site_id", "=", id)
		.where("event_type", "=", "pageview")
		.where("timestamp", ">=", startIso)
		.groupBy(tsGroup)
		.orderBy("date", "asc")
		.execute();

	return rows.map((r) => ({
		date: String(r.date ?? ""),
		pageviews: Number(r.pageviews),
		visitors: Number(r.visitors),
	}));
}

export async function queryTopPages(
	ctx: PublicApiCtx,
	siteId: string | undefined,
	range: string,
	limit: number,
) {
	const db = ctx.db;
	const id = await guardSite(ctx, siteId);

	const { start } = getDateRange(range);
	const startIso = start.toISOString();

	const rows = await db
		.selectFrom("events")
		.select([
			"path",
			({ fn }) => fn.count<number>("id").as("pageviews"),
			({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors"),
		])
		.where("site_id", "=", id)
		.where("event_type", "=", "pageview")
		.where("timestamp", ">=", startIso)
		.groupBy("path")
		.orderBy("pageviews", "desc")
		.limit(limit)
		.execute();

	return rows.map((r) => ({
		path: r.path,
		pageviews: Number(r.pageviews),
		visitors: Number(r.visitors),
	}));
}

export async function queryReferrers(
	ctx: PublicApiCtx,
	siteId: string | undefined,
	range: string,
	limit: number,
) {
	const db = ctx.db;
	const id = await guardSite(ctx, siteId);

	const { start } = getDateRange(range);
	const startIso = start.toISOString();

	// Pageviews only (custom events carry no referrer and would inflate "direct"),
	// and the site's own navigation is not a traffic source.
	const site = await db
		.selectFrom("sites")
		.select("domain")
		.where("id", "=", id)
		.executeTakeFirst();
	const rows = await db
		.selectFrom("events")
		.select([
			sourceSql.as("source"),
			({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors"),
		])
		.where("site_id", "=", id)
		.where("event_type", "=", "pageview")
		.where("timestamp", ">=", startIso)
		.where(externalReferrerOnly(site?.domain ?? ""))
		.groupBy(sourceSql)
		.orderBy("visitors", "desc")
		.limit(limit)
		.execute();

	const total = rows.reduce((s, r) => s + Number(r.visitors), 0);
	return rows.map((r) => ({
		source: String(r.source),
		visitors: Number(r.visitors),
		percentage: total > 0 ? Math.round((Number(r.visitors) / total) * 100) : 0,
	}));
}

export async function queryGeo(
	ctx: PublicApiCtx,
	siteId: string | undefined,
	range: string,
	limit: number,
) {
	const db = ctx.db;
	const id = await guardSite(ctx, siteId);

	const { start } = getDateRange(range);
	const startIso = start.toISOString();

	return db
		.selectFrom("events")
		.select([
			"country",
			"region",
			"city",
			({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors"),
		])
		.where("site_id", "=", id)
		.where("external_id", "is", null)
		.where("timestamp", ">=", startIso)
		.groupBy(["country", "region", "city"])
		.orderBy("visitors", "desc")
		.limit(limit)
		.execute();
}

export async function queryDevices(ctx: PublicApiCtx, siteId: string | undefined, range: string) {
	const db = ctx.db;
	const id = await guardSite(ctx, siteId);

	const { start } = getDateRange(range);
	const startIso = start.toISOString();

	const [deviceRows, osRows, browserRows] = await Promise.all([
		db
			.selectFrom("sessions")
			.select([
				sql<string>`COALESCE(device_type, 'unknown')`.as("device"),
				({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors"),
			])
			.where("site_id", "=", id)
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
			.where("site_id", "=", id)
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
			.where("site_id", "=", id)
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
			percentage: total > 0 ? Math.round((Number(r.visitors) / total) * 100) : 0,
		}));
	};

	return {
		devices: toEntries(deviceRows),
		os: toEntries(osRows),
		browsers: toEntries(browserRows),
	};
}

export async function queryRevenue(ctx: PublicApiCtx, siteId: string | undefined, range: string) {
	const db = ctx.db;
	const id = await guardSite(ctx, siteId);

	const { startIso, tsDate, tsGroup } = tsFragments(range);
	const money = await moneyFor(ctx, id);

	const [revBySource, revByCountry, revTs] = await Promise.all([
		// Revenue by source
		db
			.selectFrom("events")
			.select([
				sourceSql.as("source"),
				sql<number>`SUM(${revenueSql(money)})`.as("revenue"),
				sql<number>`COUNT(CASE WHEN revenue > 0 THEN 1 END)`.as("conversions"),
			])
			.where("site_id", "=", id)
			.where("revenue", "!=", 0)
			.where("timestamp", ">=", startIso)
			.groupBy(sourceSql)
			.orderBy("revenue", "desc")
			.limit(10)
			.execute(),
		// Revenue by country
		db
			.selectFrom("events")
			.select([
				sql<string>`COALESCE(country, 'unknown')`.as("country"),
				sql<number>`SUM(${revenueSql(money)})`.as("revenue"),
				sql<number>`COUNT(CASE WHEN revenue > 0 THEN 1 END)`.as("conversions"),
			])
			.where("site_id", "=", id)
			.where("revenue", "!=", 0)
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
				sql<number>`SUM(${revenueSql(money)})`.as("revenue"),
				sql<number>`COUNT(CASE WHEN revenue > 0 THEN 1 END)`.as("conversions"),
			])
			.where("site_id", "=", id)
			.where("revenue", "!=", 0)
			.where("timestamp", ">=", startIso)
			.groupBy(tsGroup)
			.orderBy("date", "asc")
			.execute(),
	]);

	return {
		currency: money.currency,
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
}

export interface PublicJourneyStep {
	path: string;
	event_type: string;
	name: string | null;
	timestamp: string;
	revenue: number | null;
	props: string | null;
}

export interface PublicJourney {
	session_id: string;
	visitor_id: string;
	visitor_name: string | null;
	visitor_email: string | null;
	country: string | null;
	region: string | null;
	city: string | null;
	device_type: string | null;
	browser: string | null;
	os: string | null;
	utm_source: string | null;
	referrer: string | null;
	started_at: string;
	steps: PublicJourneyStep[];
	total_revenue: number;
	is_identified: boolean;
}

export async function queryJourneys(
	ctx: PublicApiCtx,
	siteId: string | undefined,
	range: string,
	limit: number,
	path?: string,
): Promise<PublicJourney[]> {
	const db = ctx.db;
	const id = await guardSite(ctx, siteId);

	const { start } = getDateRange(range);
	const startIso = start.toISOString();

	// Optional path drill-down: only sessions containing a pageview whose path
	// equals or lives under the prefix ("/voltrus-mes" matches "/voltrus-mes/…"
	// and "/voltrus-mes", but not "/voltrus-mesother"). LIKE wildcards are
	// stripped so literal paths can't accidentally widen the match.
	const pathPrefix = path?.trim().replace(/\/+$/, "");
	const pathLike = pathPrefix ? pathPrefix.replace(/[%_]/g, "") + "/%" : null;

	const sessionsQuery = db
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
		.where("site_id", "=", id)
		.where("started_at", ">=", startIso)
		.$call((qb) =>
			pathPrefix && pathLike
				? qb.where((eb) =>
						eb.exists(
							eb
								.selectFrom("events")
								.select("events.session_id")
								.whereRef("events.session_id", "=", "sessions.id")
								.where("events.site_id", "=", id)
								.where("events.event_type", "=", "pageview")
								.where((eb2) =>
									eb2.or([eb2("path", "=", pathPrefix), eb2("path", "like", pathLike)]),
								),
						),
					)
				: qb,
		);

	const [recentSessions, profiles] = await Promise.all([
		sessionsQuery.orderBy("started_at", "desc").limit(limit).execute(),
		db
			.selectFrom("visitor_profiles")
			.select(["visitor_id", "name", "email"])
			.where("site_id", "=", id)
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
				.select(["session_id", "path", "event_type", "name", "timestamp", "revenue", "props"])
				.where("session_id", "in", batch)
				.where("site_id", "=", id)
				.orderBy("timestamp", "asc")
				.execute(),
		),
	);
	for (const rows of batchResults) allSessionEvents.push(...rows);
	const eventsBySession = new Map<string, typeof allSessionEvents>();
	for (const e of allSessionEvents) {
		if (!eventsBySession.has(e.session_id)) eventsBySession.set(e.session_id, []);
		eventsBySession.get(e.session_id)?.push(e);
	}

	return recentSessions.map((sess) => {
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
}

export async function queryCampaigns(ctx: PublicApiCtx, siteId: string | undefined, range: string) {
	const db = ctx.db;
	const id = await guardSite(ctx, siteId);
	const money = await moneyFor(ctx, id);

	const { start } = getDateRange(range);
	const startIso = start.toISOString();

	const rows = await db
		.selectFrom("events")
		.select([
			canonicalSource(sql.ref("utm_source")).as("utm_source"),
			"utm_medium",
			"utm_campaign",
			sql<string>`count(distinct visitor_id)`.as("visitors"),
			sql<string>`sum(case when event_type = 'pageview' then 1 else 0 end)`.as("pageviews"),
			sql<string>`sum(case when event_type = 'conversion' then 1 else 0 end)`.as("conversions"),
			sql<string>`coalesce(sum(${revenueSql(money)}), 0)`.as("revenue"),
		])
		.where("site_id", "=", id)
		.where("timestamp", ">=", startIso)
		.where("utm_source", "is not", null)
		.groupBy([canonicalSource(sql.ref("utm_source")), "utm_medium", "utm_campaign"])
		.orderBy(sql`count(distinct visitor_id)`, "desc")
		.limit(50)
		.execute();

	return rows.map((r) => ({
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
	}));
}

// --- Search Console ---

export interface GscQueryAggregate {
	query: string;
	clicks: number;
	impressions: number;
	ctr: number;
	position: number;
	days_seen: number;
	first_date: string;
	last_date: string;
}

// Stored Google Search Console queries rolled up per query over the stored
// window (~30 days; `revklik gsc sync` / the dashboard refresh the last 7).
// Same rollup as the CLI `revklik gsc queries`: clicks and impressions summed,
// ctr and position averaged across days.
export async function queryGscQueries(
	ctx: PublicApiCtx,
	siteId: string | undefined,
	limit: number,
): Promise<GscQueryAggregate[]> {
	const db = ctx.db;
	const id = await guardSite(ctx, siteId);

	const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0] ?? "";
	const rows = await db
		.selectFrom("search_console_data")
		.select([
			"query",
			({ fn }) => fn.sum<number>("clicks").as("clicks"),
			({ fn }) => fn.sum<number>("impressions").as("impressions"),
			({ fn }) => fn.avg<number>("ctr").as("ctr"),
			({ fn }) => fn.avg<number>("position").as("position"),
			({ fn }) => fn.count<number>("id").as("days_seen"),
			({ fn }) => fn.min("date").as("first_date"),
			({ fn }) => fn.max("date").as("last_date"),
		])
		.where("site_id", "=", id)
		.where("date", ">=", thirtyDaysAgo)
		.groupBy("query")
		.orderBy("clicks", "desc")
		.limit(limit)
		.execute();

	return rows.map((r) => ({
		query: r.query,
		clicks: Number(r.clicks),
		impressions: Number(r.impressions),
		ctr: Number(r.ctr),
		position: Number(r.position),
		days_seen: Number(r.days_seen),
		first_date: String(r.first_date),
		last_date: String(r.last_date),
	}));
}

// --- Export ---

export const EXPORT_COLUMNS = {
	events: [
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
		"pr",
		"timestamp",
	],
	visitors: [
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
	],
	sessions: [
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
	],
} as const;

export interface ExportOptions {
	type: "events" | "visitors" | "sessions";
	eventType?: string;
	limit: number;
}

/**
 * Raw export rows for a type. Events rows keep `props` raw (string|null);
 * callers decide JSON parsing (eventsRowsToJson) vs CSV mapping (props→pr).
 */
export async function exportRows(
	ctx: PublicApiCtx,
	siteId: string | undefined,
	range: string,
	opts: ExportOptions,
): Promise<Record<string, unknown>[]> {
	const db = ctx.db;
	const id = await guardSite(ctx, siteId);

	const { start } = getDateRange(range);
	const startIso = start.toISOString();

	if (opts.type === "visitors") {
		return db
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
			.where("site_id", "=", id)
			.orderBy("last_seen", "desc")
			.limit(10000)
			.execute();
	}

	if (opts.type === "sessions") {
		return db
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
			.where("site_id", "=", id)
			.where("started_at", ">=", startIso)
			.orderBy("started_at", "desc")
			.limit(10000)
			.execute();
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
			"props",
			"timestamp",
		])
		.where("site_id", "=", id)
		.where("timestamp", ">=", startIso);
	if (opts.eventType) eventsQuery = eventsQuery.where("event_type", "=", opts.eventType as never);
	return eventsQuery.orderBy("timestamp", "desc").limit(opts.limit).execute();
}

/** Events export rows with `props` JSON-parsed into `pr` (JSON format). */
export function eventsRowsToJson(
	rows: { props: string | null; [k: string]: unknown }[],
): Record<string, unknown>[] {
	return rows.map(({ props, ...rest }) => {
		let pr: Record<string, unknown> | null = null;
		if (props) {
			try {
				pr = JSON.parse(props) as Record<string, unknown>;
			} catch {
				/* malformed json — leave pr null */
			}
		}
		return { ...rest, pr };
	});
}

/** Events export rows with `props` renamed to `pr` (CSV format). */
export function eventsRowsForCsv(
	rows: { props: string | null; [k: string]: unknown }[],
): Record<string, unknown>[] {
	return rows.map(({ props, ...rest }) => ({ ...rest, pr: props }));
}

export { toCsv };
