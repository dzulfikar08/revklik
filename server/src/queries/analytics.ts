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
} from "shared";
import { sql } from "../db";
import type { ParsedFilter } from "../lib/analytics-queries";
import { applyFilters } from "../lib/analytics-queries";
import { categorizeChannel } from "../lib/webhook-utils";

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

export async function getOverviewStats(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	filters?: ParsedFilter[],
): Promise<StatsResponse> {
	const [pv, vi, se, bo, rev, conv] = await Promise.all([
		applyFilters(
			db
				.selectFrom("events")
				.select(({ fn }) => [fn.count<number>("id").as("count")])
				.where("site_id", "=", siteId)
				.where("event_type", "=", "pageview")
				.where("timestamp", ">=", startIso),
			filters,
		).executeTakeFirst(),
		applyFilters(
			db
				.selectFrom("events")
				.select(({ fn }) => [
					fn.count<number>("visitor_id").distinct().as("count"),
				])
				.where("site_id", "=", siteId)
				.where("timestamp", ">=", startIso),
			filters,
		).executeTakeFirst(),
		applyFilters(
			db
				.selectFrom("sessions")
				.select(({ fn }) => [fn.count<number>("id").as("count")])
				.where("site_id", "=", siteId)
				.where("started_at", ">=", startIso),
			filters,
		).executeTakeFirst(),
		applyFilters(
			db
				.selectFrom("sessions")
				.select(({ fn }) => [fn.avg<number>("is_bounce").as("avg")])
				.where("site_id", "=", siteId)
				.where("started_at", ">=", startIso),
			filters,
		).executeTakeFirst(),
		applyFilters(
			db
				.selectFrom("events")
				.select(({ fn }) => [fn.sum<number>("revenue").as("total")])
				.where("site_id", "=", siteId)
				.where("revenue", ">", 0)
				.where("timestamp", ">=", startIso),
			filters,
		).executeTakeFirst(),
		applyFilters(
			db
				.selectFrom("events")
				.select(({ fn }) => [fn.count<number>("id").as("count")])
				.where("site_id", "=", siteId)
				.where("event_type", "=", "conversion")
				.where("timestamp", ">=", startIso),
			filters,
		).executeTakeFirst(),
	]);

	return {
		pageviews: Number(pv?.count ?? 0),
		visitors: Number(vi?.count ?? 0),
		sessions: Number(se?.count ?? 0),
		bounceRate: Math.round(Number(bo?.avg ?? 0) * 100),
		avgDuration: 0,
		revenue: Number(rev?.total ?? 0),
		conversions: Number(conv?.count ?? 0),
	};
}

export async function getTimeseries(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	isHourly: boolean,
	filters?: ParsedFilter[],
): Promise<TimeSeriesPoint[]> {
	const tsDate = isHourly
		? sql<string>`strftime('%Y-%m-%dT%H:00:00', ${sql.ref("timestamp")})`
		: sql<string>`date(${sql.ref("timestamp")})`;
	const tsGroup = isHourly
		? sql`strftime('%Y-%m-%dT%H:00:00', ${sql.ref("timestamp")})`
		: sql`date(${sql.ref("timestamp")})`;

	const tsRows = await applyFilters(
		db
			.selectFrom("events")
			.select([
				({ fn }) => fn.count<number>("id").as("pageviews"),
				({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors"),
				tsDate.as("date"),
			])
			.where("site_id", "=", siteId)
			.where("event_type", "=", "pageview")
			.where("timestamp", ">=", startIso),
		filters,
	)
		.groupBy(tsGroup)
		.orderBy("date", "asc")
		.execute();

	return tsRows.map((r) => ({
		date: String(r.date ?? ""),
		pageviews: Number(r.pageviews),
		visitors: Number(r.visitors),
	}));
}

export async function getTopPages(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	limit: number,
	filters?: ParsedFilter[],
): Promise<TopPage[]> {
	const pageRows = await applyFilters(
		db
			.selectFrom("events")
			.select([
				"path",
				({ fn }) => fn.count<number>("id").as("pageviews"),
				({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors"),
			])
			.where("site_id", "=", siteId)
			.where("event_type", "=", "pageview")
			.where("timestamp", ">=", startIso),
		filters,
	)
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
): Promise<SourceEntry[]> {
	const sourceRows = await applyFilters(
		db
			.selectFrom("events")
			.select([
				sourceSql.as("source"),
				({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors"),
			])
			.where("site_id", "=", siteId)
			.where("timestamp", ">=", startIso),
		filters,
	)
		.groupBy(sourceSql)
		.orderBy("visitors", "desc")
		.limit(limit)
		.execute();

	const totalSrc = sourceRows.reduce(
		(s: number, r) => s + Number(r.visitors),
		0,
	);
	return sourceRows.map((r) => ({
		source: String(r.source),
		visitors: Number(r.visitors),
		percentage:
			totalSrc > 0 ? Math.round((Number(r.visitors) / totalSrc) * 100) : 0,
	}));
}

export async function getDeviceBreakdown(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	filters?: ParsedFilter[],
): Promise<{
	devices: DeviceEntry[];
	os: DeviceEntry[];
	browsers: DeviceEntry[];
}> {
	const [deviceRows, osRows, browserRows] = await Promise.all([
		applyFilters(
			db
				.selectFrom("sessions")
				.select([
					sql<string>`COALESCE(device_type, 'unknown')`.as("device"),
					({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors"),
				])
				.where("site_id", "=", siteId)
				.where("started_at", ">=", startIso),
			filters,
		)
			.groupBy("device_type")
			.orderBy("visitors", "desc")
			.limit(10)
			.execute(),
		applyFilters(
			db
				.selectFrom("sessions")
				.select([
					sql<string>`COALESCE(os, 'unknown')`.as("device"),
					({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors"),
				])
				.where("site_id", "=", siteId)
				.where("started_at", ">=", startIso),
			filters,
		)
			.groupBy("os")
			.orderBy("visitors", "desc")
			.limit(10)
			.execute(),
		applyFilters(
			db
				.selectFrom("sessions")
				.select([
					sql<string>`COALESCE(browser, 'unknown')`.as("device"),
					({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors"),
				])
				.where("site_id", "=", siteId)
				.where("started_at", ">=", startIso),
			filters,
		)
			.groupBy("browser")
			.orderBy("visitors", "desc")
			.limit(10)
			.execute(),
	]);

	const totalDev = deviceRows.reduce(
		(s: number, r) => s + Number(r.visitors),
		0,
	);
	const devices: DeviceEntry[] = deviceRows.map((r) => ({
		device: String(r.device),
		visitors: Number(r.visitors),
		percentage:
			totalDev > 0 ? Math.round((Number(r.visitors) / totalDev) * 100) : 0,
	}));

	const totalOs = osRows.reduce(
		(s: number, r) => s + Number(r.visitors),
		0,
	);
	const os: DeviceEntry[] = osRows.map((r) => ({
		device: String(r.device),
		visitors: Number(r.visitors),
		percentage:
			totalOs > 0 ? Math.round((Number(r.visitors) / totalOs) * 100) : 0,
	}));

	const totalBr = browserRows.reduce(
		(s: number, r) => s + Number(r.visitors),
		0,
	);
	const browsers: DeviceEntry[] = browserRows.map((r) => ({
		device: String(r.device),
		visitors: Number(r.visitors),
		percentage:
			totalBr > 0 ? Math.round((Number(r.visitors) / totalBr) * 100) : 0,
	}));

	return { devices, os, browsers };
}

export async function getGeoData(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	limit: number,
	filters?: ParsedFilter[],
) {
	return applyFilters(
		db
			.selectFrom("events")
			.select([
				"country",
				"region",
				"city",
				({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors"),
			])
			.where("site_id", "=", siteId)
			.where("timestamp", ">=", startIso),
		filters,
	)
		.groupBy(["country", "region", "city"])
		.orderBy("visitors", "desc")
		.limit(limit)
		.execute();
}

export async function getRevenueBySource(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	filters?: ParsedFilter[],
): Promise<RevenueBySource[]> {
	const rows = await applyFilters(
		db
			.selectFrom("events")
			.select([
				sourceSql.as("source"),
				({ fn }) => fn.sum<number>("revenue").as("revenue"),
				({ fn }) => fn.count<number>("id").as("conversions"),
			])
			.where("site_id", "=", siteId)
			.where("revenue", ">", 0)
			.where("timestamp", ">=", startIso),
		filters,
	)
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
): Promise<RevenueByCountry[]> {
	const rows = await applyFilters(
		db
			.selectFrom("events")
			.select([
				sql<string>`COALESCE(country, 'unknown')`.as("country"),
				({ fn }) => fn.sum<number>("revenue").as("revenue"),
				({ fn }) => fn.count<number>("id").as("conversions"),
			])
			.where("site_id", "=", siteId)
			.where("revenue", ">", 0)
			.where("timestamp", ">=", startIso),
		filters,
	)
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
): Promise<RevenueTimeSeriesPoint[]> {
	const tsDate = isHourly
		? sql<string>`strftime('%Y-%m-%dT%H:00:00', ${sql.ref("timestamp")})`
		: sql<string>`date(${sql.ref("timestamp")})`;
	const tsGroup = isHourly
		? sql`strftime('%Y-%m-%dT%H:00:00', ${sql.ref("timestamp")})`
		: sql`date(${sql.ref("timestamp")})`;

	const rows = await applyFilters(
		db
			.selectFrom("events")
			.select([
				tsDate.as("date"),
				({ fn }) => fn.sum<number>("revenue").as("revenue"),
				({ fn }) => fn.count<number>("id").as("conversions"),
			])
			.where("site_id", "=", siteId)
			.where("revenue", ">", 0)
			.where("timestamp", ">=", startIso),
		filters,
	)
		.groupBy(tsGroup)
		.orderBy("date", "asc")
		.execute();

	return rows.map((r) => ({
		date: String(r.date ?? ""),
		revenue: Number(r.revenue ?? 0),
		conversions: Number(r.conversions ?? 0),
	}));
}

export async function getEntryPagesRevenue(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	filters?: ParsedFilter[],
): Promise<EntryPageRevenue[]> {
	const rows = await applyFilters(
		db
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
			.where("events.site_id", "=", siteId),
		filters,
	)
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
): Promise<RevenueByPaymentMethod[]> {
	const rows = await applyFilters(
		db
			.selectFrom("events")
			.select([
				sql<string>`COALESCE(payment_method, 'unknown')`.as("method"),
				sql<number>`COUNT(*)`.as("count"),
				sql<number>`COALESCE(SUM(revenue), 0)`.as("revenue"),
			])
			.where("site_id", "=", siteId)
			.where("revenue", ">", 0)
			.where("timestamp", ">=", startIso),
		filters,
	)
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
): Promise<RevenueByPaymentProvider[]> {
	const rows = await applyFilters(
		db
			.selectFrom("events")
			.select([
				sql<string>`COALESCE(payment_provider, 'unknown')`.as("provider"),
				sql<number>`COUNT(*)`.as("count"),
				sql<number>`COALESCE(SUM(revenue), 0)`.as("revenue"),
			])
			.where("site_id", "=", siteId)
			.where("revenue", ">", 0)
			.where("timestamp", ">=", startIso),
		filters,
	)
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
): Promise<ChannelEntry[]> {
	const rows = await applyFilters(
		db
			.selectFrom("events")
			.select([
				"referrer",
				"utm_source",
				"utm_medium",
				"visitor_id",
				"id",
				"revenue",
			])
			.where("site_id", "=", siteId)
			.where("timestamp", ">=", startIso),
		filters,
	).execute();

	const channelMap = new Map<
		string,
		{ visitors: Set<string>; pageviews: number; revenue: number }
	>();
	for (const row of rows) {
		const channel = categorizeChannel(
			row.referrer,
			row.utm_source,
			row.utm_medium,
		);
		if (!channelMap.has(channel))
			channelMap.set(channel, {
				visitors: new Set(),
				pageviews: 0,
				revenue: 0,
			});
		const entry = channelMap.get(channel)!;
		entry.visitors.add(row.visitor_id);
		entry.pageviews++;
		if (row.revenue) entry.revenue += Number(row.revenue);
	}

	const totalVisitors =
		[...channelMap.values()].reduce((s, e) => s + e.visitors.size, 0) || 1;
	return [...channelMap.entries()]
		.map(([channel, data]) => ({
			channel,
			visitors: data.visitors.size,
			pageviews: data.pageviews,
			revenue: data.revenue,
			percentage: Math.round((data.visitors.size / totalVisitors) * 100),
		}))
		.sort((a, b) => b.visitors - a.visitors);
}
