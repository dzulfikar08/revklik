import type { Kysely } from "kysely";
import type {
	ChannelEntry,
	DeviceEntry,
	EntryPageRevenue,
	KlikapaDatabase,
	RevenueByCountry,
	RevenueByPaymentMethod,
	RevenueByPaymentProvider,
	RevenueBySource,
	RevenueTimeSeriesPoint,
	SourceEntry,
	StatsResponse,
	TimeSeriesPoint,
	TopPage,
} from "@revklik/shared";
import { sql } from "../db";
import type { ParsedFilter } from "../lib/analytics-queries";
import { applyFilters, applySessionFilters } from "../lib/analytics-queries";

const sourceSql = sql<string>`COALESCE(utm_source,
  CASE WHEN referrer IS NULL OR referrer = '' THEN 'direct'
  WHEN referrer LIKE '%ig_text_post_permalink%' OR referrer LIKE '%ig_text_feed_timeline%' THEN 'instagram'
  ELSE
    CASE LOWER(REPLACE(
        SUBSTR(SUBSTR(referrer, INSTR(referrer, '://') + 3), 1,
          INSTR(SUBSTR(referrer, INSTR(referrer, '://') + 3) || '/', '/') - 1),
        'www.', ''))
      WHEN 'l.threads.com' THEN 'threads'
      WHEN 'threads.net' THEN 'threads'
      WHEN 'm.facebook.com' THEN 'facebook'
      WHEN 'facebook.com' THEN 'facebook'
      WHEN 'fb.me' THEN 'facebook'
      WHEN 't.co' THEN 'twitter'
      WHEN 'instagram.com' THEN 'instagram'
      ELSE LOWER(REPLACE(
        SUBSTR(SUBSTR(referrer, INSTR(referrer, '://') + 3), 1,
          INSTR(SUBSTR(referrer, INSTR(referrer, '://') + 3) || '/', '/') - 1),
        'www.', ''))
    END
  END)`;

/**
 * Generate continuous bucket keys (UTC) between start and end so charts can
 * render empty days/hours as 0 instead of dropping them.
 */
function bucketKeys(startIso: string, endIso: string | undefined, isHourly: boolean): string[] {
	const stepMs = isHourly ? 3_600_000 : 86_400_000;
	const startMs = new Date(startIso).getTime();
	const endMs = Math.min(endIso ? new Date(endIso).getTime() : Date.now(), Date.now());
	const keys: string[] = [];
	for (let t = startMs; t < endMs; t += stepMs) {
		const d = new Date(t);
		keys.push(isHourly ? `${d.toISOString().slice(0, 13)}:00:00` : d.toISOString().slice(0, 10));
	}
	return keys;
}

export async function getOverviewStats(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	filters?: ParsedFilter[],
	endIso?: string,
): Promise<StatsResponse> {
	let eventQ = db
		.selectFrom("events")
		.select([
			sql<number>`COUNT(CASE WHEN event_type = 'pageview' THEN 1 END)`.as("pageviews"),
			({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors"),
			sql<number>`COALESCE(SUM(CASE WHEN revenue > 0 THEN revenue END), 0)`.as("revenue"),
			sql<number>`COUNT(CASE WHEN event_type = 'conversion' THEN 1 END)`.as("conversions"),
		])
		.where("site_id", "=", siteId)
		.where("timestamp", ">=", startIso);
	if (endIso) eventQ = eventQ.where("timestamp", "<", endIso);

	let sessionQ = db
		.selectFrom("sessions")
		.select([
			({ fn }) => fn.count<number>("id").as("sessions"),
			({ fn }) => fn.avg<number>("is_bounce").as("bounce"),
			sql<number>`AVG(CASE WHEN ended_at IS NOT NULL THEN (julianday(ended_at) - julianday(started_at)) * 86400 END)`.as(
				"avg_duration",
			),
		])
		.where("site_id", "=", siteId)
		.where("started_at", ">=", startIso);
	if (endIso) sessionQ = sessionQ.where("started_at", "<", endIso);

	const [ev, se] = await Promise.all([
		applyFilters(eventQ, filters).executeTakeFirst(),
		applySessionFilters(sessionQ, { db, siteId, startIso, endIso }, filters).executeTakeFirst(),
	]);

	return {
		pageviews: Number(ev?.pageviews ?? 0),
		visitors: Number(ev?.visitors ?? 0),
		sessions: Number(se?.sessions ?? 0),
		bounceRate: Math.round(Number(se?.bounce ?? 0) * 100),
		avgDuration: Math.round(Number(se?.avg_duration ?? 0)),
		revenue: Number(ev?.revenue ?? 0),
		conversions: Number(ev?.conversions ?? 0),
	};
}

export async function getTimeseries(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	isHourly: boolean,
	filters?: ParsedFilter[],
	endIso?: string,
): Promise<TimeSeriesPoint[]> {
	const tsDate = isHourly
		? sql<string>`strftime('%Y-%m-%dT%H:00:00', ${sql.ref("timestamp")})`
		: sql<string>`date(${sql.ref("timestamp")})`;
	const tsGroup = isHourly
		? sql`strftime('%Y-%m-%dT%H:00:00', ${sql.ref("timestamp")})`
		: sql`date(${sql.ref("timestamp")})`;

	let q = db
		.selectFrom("events")
		.select([
			tsDate.as("date"),
			({ fn }) => fn.count<number>("id").as("pageviews"),
			({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors"),
		])
		.where("site_id", "=", siteId)
		.where("event_type", "=", "pageview")
		.where("timestamp", ">=", startIso);
	if (endIso) q = q.where("timestamp", "<", endIso);

	const tsRows = await applyFilters(q, filters).groupBy(tsGroup).orderBy("date", "asc").execute();

	const byKey = new Map(tsRows.map((r) => [String(r.date ?? ""), r]));
	return bucketKeys(startIso, endIso, isHourly).map((key) => {
		const row = byKey.get(key);
		return {
			date: key,
			pageviews: Number(row?.pageviews ?? 0),
			visitors: Number(row?.visitors ?? 0),
		};
	});
}

export async function getTopPages(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	limit: number,
	filters?: ParsedFilter[],
	endIso?: string,
): Promise<TopPage[]> {
	let q = db
		.selectFrom("events")
		.select([
			"path",
			({ fn }) => fn.count<number>("id").as("pageviews"),
			({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors"),
		])
		.where("site_id", "=", siteId)
		.where("event_type", "=", "pageview")
		.where("timestamp", ">=", startIso);
	if (endIso) q = q.where("timestamp", "<", endIso);

	const pageRows = await applyFilters(q, filters)
		.groupBy("path")
		.orderBy("pageviews", "desc")
		.limit(limit)
		.execute();

	return pageRows.map((r) => ({
		path: r.path,
		pageviews: Number(r.pageviews),
		visitors: Number(r.visitors),
	}));
}

export async function getReferrers(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	limit: number,
	filters?: ParsedFilter[],
	endIso?: string,
): Promise<SourceEntry[]> {
	let q = db
		.selectFrom("events")
		.select([
			sourceSql.as("source"),
			({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors"),
		])
		.where("site_id", "=", siteId)
		.where("timestamp", ">=", startIso);
	if (endIso) q = q.where("timestamp", "<", endIso);

	const sourceRows = await applyFilters(q, filters)
		.groupBy(sourceSql)
		.orderBy("visitors", "desc")
		.limit(limit)
		.execute();

	const totalSrc = sourceRows.reduce((s: number, r) => s + Number(r.visitors), 0);
	return sourceRows.map((r) => ({
		source: String(r.source),
		visitors: Number(r.visitors),
		percentage: totalSrc > 0 ? Math.round((Number(r.visitors) / totalSrc) * 100) : 0,
	}));
}

export async function getDeviceBreakdown(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	filters?: ParsedFilter[],
	endIso?: string,
): Promise<{
	devices: DeviceEntry[];
	os: DeviceEntry[];
	browsers: DeviceEntry[];
}> {
	const base = (col: string) => {
		let q = db
			.selectFrom("sessions")
			.select([
				sql<string>`COALESCE(${sql.ref(col)}, 'unknown')`.as("device"),
				({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors"),
			])
			.where("site_id", "=", siteId)
			.where("started_at", ">=", startIso);
		if (endIso) q = q.where("started_at", "<", endIso);
		return q;
	};

	const [deviceRows, osRows, browserRows] = await Promise.all([
		applySessionFilters(base("device_type"), { db, siteId, startIso, endIso }, filters)
			.groupBy("device_type")
			.orderBy("visitors", "desc")
			.limit(10)
			.execute(),
		applySessionFilters(base("os"), { db, siteId, startIso, endIso }, filters)
			.groupBy("os")
			.orderBy("visitors", "desc")
			.limit(10)
			.execute(),
		applySessionFilters(base("browser"), { db, siteId, startIso, endIso }, filters)
			.groupBy("browser")
			.orderBy("visitors", "desc")
			.limit(10)
			.execute(),
	]);

	const toEntries = (rows: { device: string; visitors: number | bigint }[]) => {
		const total = rows.reduce((s: number, r) => s + Number(r.visitors), 0);
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

export async function getGeoData(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	limit: number,
	filters?: ParsedFilter[],
	endIso?: string,
) {
	let q = db
		.selectFrom("events")
		.select([
			"country",
			"region",
			"city",
			({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors"),
		])
		.where("site_id", "=", siteId)
		.where("timestamp", ">=", startIso);
	if (endIso) q = q.where("timestamp", "<", endIso);

	return applyFilters(q, filters)
		.groupBy(["country", "region", "city"])
		.orderBy("visitors", "desc")
		.limit(limit)
		.execute();
}

export interface ExitPage {
	path: string;
	exits: number;
}

export async function getExitPages(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	filters?: ParsedFilter[],
	endIso?: string,
): Promise<ExitPage[]> {
	let q = db
		.selectFrom("sessions")
		.select(["exit_path as path", ({ fn }) => fn.count<number>("id").as("exits")]);
	const rows = await applySessionFilters(q, { db, siteId, startIso, endIso }, filters)
		.groupBy("exit_path")
		.orderBy("exits", "desc")
		.limit(10)
		.execute();
	return rows.map((r) => ({
		path: String(r.path ?? "/"),
		exits: Number(r.exits),
	}));
}

export async function getRevenueBySource(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	filters?: ParsedFilter[],
	endIso?: string,
): Promise<RevenueBySource[]> {
	let q = db
		.selectFrom("events")
		.select([
			sourceSql.as("source"),
			({ fn }) => fn.sum<number>("revenue").as("revenue"),
			({ fn }) => fn.count<number>("id").as("conversions"),
		])
		.where("site_id", "=", siteId)
		.where("revenue", ">", 0)
		.where("timestamp", ">=", startIso);
	if (endIso) q = q.where("timestamp", "<", endIso);

	const rows = await applyFilters(q, filters)
		.groupBy(sourceSql)
		.orderBy("revenue", "desc")
		.limit(10)
		.execute();

	return rows.map((r) => ({
		source: String(r.source),
		revenue: Number(r.revenue ?? 0),
		conversions: Number(r.conversions ?? 0),
	}));
}

export async function getRevenueByCountry(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	filters?: ParsedFilter[],
	endIso?: string,
): Promise<RevenueByCountry[]> {
	let q = db
		.selectFrom("events")
		.select([
			sql<string>`COALESCE(country, 'unknown')`.as("country"),
			({ fn }) => fn.sum<number>("revenue").as("revenue"),
			({ fn }) => fn.count<number>("id").as("conversions"),
		])
		.where("site_id", "=", siteId)
		.where("revenue", ">", 0)
		.where("timestamp", ">=", startIso);
	if (endIso) q = q.where("timestamp", "<", endIso);

	const rows = await applyFilters(q, filters)
		.groupBy("country")
		.orderBy("revenue", "desc")
		.limit(10)
		.execute();

	return rows.map((r) => ({
		country: String(r.country),
		revenue: Number(r.revenue ?? 0),
		conversions: Number(r.conversions ?? 0),
	}));
}

export async function getRevenueTimeseries(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	isHourly: boolean,
	filters?: ParsedFilter[],
	endIso?: string,
): Promise<RevenueTimeSeriesPoint[]> {
	const tsDate = isHourly
		? sql<string>`strftime('%Y-%m-%dT%H:00:00', ${sql.ref("timestamp")})`
		: sql<string>`date(${sql.ref("timestamp")})`;
	const tsGroup = isHourly
		? sql`strftime('%Y-%m-%dT%H:00:00', ${sql.ref("timestamp")})`
		: sql`date(${sql.ref("timestamp")})`;

	let q = db
		.selectFrom("events")
		.select([
			tsDate.as("date"),
			({ fn }) => fn.sum<number>("revenue").as("revenue"),
			({ fn }) => fn.count<number>("id").as("conversions"),
		])
		.where("site_id", "=", siteId)
		.where("revenue", ">", 0)
		.where("timestamp", ">=", startIso);
	if (endIso) q = q.where("timestamp", "<", endIso);

	const rows = await applyFilters(q, filters).groupBy(tsGroup).orderBy("date", "asc").execute();

	const byKey = new Map(rows.map((r) => [String(r.date ?? ""), r]));
	return bucketKeys(startIso, endIso, isHourly).map((key) => {
		const row = byKey.get(key);
		return {
			date: key,
			revenue: Number(row?.revenue ?? 0),
			conversions: Number(row?.conversions ?? 0),
		};
	});
}

export async function getEntryPagesRevenue(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	filters?: ParsedFilter[],
	endIso?: string,
): Promise<EntryPageRevenue[]> {
	let q = db
		.selectFrom("sessions")
		.innerJoin("events", "events.session_id", "sessions.id")
		.select([
			"sessions.entry_path as path",
			sql<number>`COUNT(DISTINCT sessions.id)`.as("sessions"),
			sql<number>`COUNT(DISTINCT CASE WHEN events.event_type = 'conversion' OR events.event_type = 'payment' THEN events.id END)`.as(
				"conversions",
			),
			sql<number>`COALESCE(SUM(CASE WHEN events.revenue > 0 THEN events.revenue END), 0)`.as(
				"revenue",
			),
		])
		.where("sessions.site_id", "=", siteId)
		.where("sessions.started_at", ">=", startIso)
		.where("events.site_id", "=", siteId);
	if (endIso) q = q.where("sessions.started_at", "<", endIso);

	const rows = await applyFilters(q, filters, "events")
		.groupBy("sessions.entry_path")
		.orderBy("revenue", "desc")
		.limit(20)
		.execute();
	return rows.map((r) => ({
		path: String(r.path ?? "/"),
		sessions: Number(r.sessions),
		conversions: Number(r.conversions),
		revenue: Number(r.revenue),
	}));
}

export async function getRevenueByPaymentMethod(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	filters?: ParsedFilter[],
	endIso?: string,
): Promise<RevenueByPaymentMethod[]> {
	let q = db
		.selectFrom("events")
		.select([
			sql<string>`COALESCE(payment_method, 'unknown')`.as("method"),
			sql<number>`COUNT(*)`.as("count"),
			sql<number>`COALESCE(SUM(revenue), 0)`.as("revenue"),
		])
		.where("site_id", "=", siteId)
		.where("revenue", ">", 0)
		.where("timestamp", ">=", startIso);
	if (endIso) q = q.where("timestamp", "<", endIso);

	const rows = await applyFilters(q, filters)
		.groupBy("payment_method")
		.orderBy("revenue", "desc")
		.execute();
	return rows.map((r) => ({
		method: String(r.method),
		count: Number(r.count),
		revenue: Number(r.revenue),
	}));
}

export async function getRevenueByPaymentProvider(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	filters?: ParsedFilter[],
	endIso?: string,
): Promise<RevenueByPaymentProvider[]> {
	let q = db
		.selectFrom("events")
		.select([
			sql<string>`COALESCE(payment_provider, 'unknown')`.as("provider"),
			sql<number>`COUNT(*)`.as("count"),
			sql<number>`COALESCE(SUM(revenue), 0)`.as("revenue"),
		])
		.where("site_id", "=", siteId)
		.where("revenue", ">", 0)
		.where("timestamp", ">=", startIso);
	if (endIso) q = q.where("timestamp", "<", endIso);

	const rows = await applyFilters(q, filters)
		.groupBy("payment_provider")
		.orderBy("revenue", "desc")
		.execute();
	return rows.map((r) => ({
		provider: String(r.provider),
		count: Number(r.count),
		revenue: Number(r.revenue),
	}));
}

export async function getChannelBreakdown(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	filters?: ParsedFilter[],
	endIso?: string,
): Promise<ChannelEntry[]> {
	// Mirrors categorizeChannel() — kept in SQL so we aggregate server-side
	// instead of shipping every raw event row to the Worker.
	const channelExpr = sql<string>`CASE
		WHEN utm_medium IN ('cpc', 'ppc', 'paid') THEN 'Paid'
		WHEN utm_medium = 'email' THEN 'Email'
		WHEN utm_medium IN ('social', 'social-media') THEN 'Social Media'
		WHEN referrer IS NULL OR referrer = '' THEN 'Direct'
		WHEN LOWER(referrer) LIKE '%facebook.com%'
			OR LOWER(referrer) LIKE '%twitter.com%'
			OR LOWER(referrer) LIKE '%x.com%'
			OR LOWER(referrer) LIKE '%instagram.com%'
			OR LOWER(referrer) LIKE '%tiktok.com%'
			OR LOWER(referrer) LIKE '%linkedin.com%'
			OR LOWER(referrer) LIKE '%youtube.com%'
			OR LOWER(referrer) LIKE '%reddit.com%' THEN 'Social Media'
		WHEN LOWER(referrer) LIKE '%google.com%'
			OR LOWER(referrer) LIKE '%bing.com%'
			OR LOWER(referrer) LIKE '%yahoo.com%'
			OR LOWER(referrer) LIKE '%baidu.com%'
			OR LOWER(referrer) LIKE '%duckduckgo.com%'
			OR LOWER(referrer) LIKE '%yandex.com%'
			OR LOWER(referrer) LIKE '%google.co.id%' THEN 'Organic Search'
		ELSE 'Referral'
	END`;

	let q = db
		.selectFrom("events")
		.select([
			channelExpr.as("channel"),
			({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors"),
			({ fn }) => fn.count<number>("id").as("pageviews"),
			sql<number>`COALESCE(SUM(CASE WHEN revenue > 0 THEN revenue END), 0)`.as("revenue"),
		])
		.where("site_id", "=", siteId)
		.where("timestamp", ">=", startIso);
	if (endIso) q = q.where("timestamp", "<", endIso);

	const rows = await applyFilters(q, filters).groupBy(channelExpr).execute();

	const totalVisitors = rows.reduce((s, r) => s + Number(r.visitors), 0) || 1;
	return rows
		.map((r) => ({
			channel: String(r.channel),
			visitors: Number(r.visitors),
			pageviews: Number(r.pageviews),
			revenue: Number(r.revenue ?? 0),
			percentage: Math.round((Number(r.visitors) / totalVisitors) * 100),
		}))
		.sort((a, b) => b.visitors - a.visitors);
}
