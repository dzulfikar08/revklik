import type { Compilable, Kysely } from "kysely";
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
import { D1_BATCH_CHUNK } from "../lib/d1-batch";
import { avgSessionSecondsSql } from "../lib/session-duration";
import { externalReferrerOnly, sourceSql } from "../lib/source-sql";
import { type MoneyContext, revenueSql, USD_MONEY } from "../lib/fx";

/** Per-request presentation: revenue display currency and bucket timezone. */
export interface QueryScope {
	money: MoneyContext;
	/** East-positive minutes; daily/hourly buckets are cut at this offset. */
	tzOffset: number;
}

export const DEFAULT_SCOPE: QueryScope = { money: USD_MONEY, tzOffset: 0 };

/**
 * One read split from how its rows become a result, so the same statements run
 * either one-by-one through Kysely or together in a single D1 round trip.
 * `read` receives one row array per entry of `queries`, in order.
 */
export interface QueryPlan<T> {
	queries: Compilable<unknown>[];
	read(results: unknown[][]): T;
}

export function queryPlan<R, T>(query: Compilable<R>, read: (rows: R[]) => T): QueryPlan<T> {
	return { queries: [query], read: ([rows]) => read((rows ?? []) as R[]) };
}

export async function executePlan<T>(db: Kysely<KlikapaDatabase>, p: QueryPlan<T>): Promise<T> {
	const results = await Promise.all(p.queries.map((q) => db.executeQuery(q)));
	return p.read(results.map((r) => r.rows as unknown[]));
}

type PlanResults<P extends readonly QueryPlan<unknown>[]> = {
	-readonly [K in keyof P]: P[K] extends QueryPlan<infer T> ? T : never;
};

/**
 * Runs every plan's statements through D1's batch API — one round trip per
 * D1_BATCH_CHUNK statements instead of one per query. Compiling applies the
 * Kysely plugins, so bot filtering matches the non-batched path.
 */
export async function runBatch<const P extends readonly QueryPlan<unknown>[]>(
	d1: D1Database,
	plans: P,
): Promise<PlanResults<P>> {
	const stmts = plans.flatMap((p) =>
		p.queries.map((q) => {
			const compiled = q.compile();
			return d1.prepare(compiled.sql).bind(...compiled.parameters);
		}),
	);
	const rows: unknown[][] = [];
	for (let i = 0; i < stmts.length; i += D1_BATCH_CHUNK) {
		const results = await d1.batch(stmts.slice(i, i + D1_BATCH_CHUNK));
		for (const r of results) rows.push((r.results ?? []) as unknown[]);
	}
	let offset = 0;
	return plans.map((p) => {
		const out = p.read(rows.slice(offset, offset + p.queries.length));
		offset += p.queries.length;
		return out;
	}) as PlanResults<P>;
}

export function bucketSql(isHourly: boolean, tzOffset: number, column = "timestamp") {
	const ref = sql.ref(column);
	if (tzOffset === 0) {
		return isHourly
			? sql<string>`strftime('%Y-%m-%dT%H:00:00', ${ref})`
			: sql<string>`date(${ref})`;
	}
	const shift = `${tzOffset >= 0 ? "+" : ""}${tzOffset} minutes`;
	return isHourly
		? sql<string>`strftime('%Y-%m-%dT%H:00:00', ${ref}, ${shift})`
		: sql<string>`date(${ref}, ${shift})`;
}

/**
 * Continuous bucket keys, in the scope's local time, for every day/hour the
 * range touches (first and last partial buckets included) so charts render
 * empty buckets as 0 instead of dropping them.
 */
export function bucketKeys(
	startIso: string,
	endIso: string | undefined,
	isHourly: boolean,
	tzOffset = 0,
): string[] {
	const stepMs = isHourly ? 3_600_000 : 86_400_000;
	const shiftMs = tzOffset * 60_000;
	const startLocal = new Date(startIso).getTime() + shiftMs;
	const endLocal = Math.min(endIso ? new Date(endIso).getTime() : Date.now(), Date.now()) + shiftMs;
	const keys: string[] = [];
	for (let t = Math.floor(startLocal / stepMs) * stepMs; t < endLocal; t += stepMs) {
		const d = new Date(t);
		keys.push(isHourly ? `${d.toISOString().slice(0, 13)}:00:00` : d.toISOString().slice(0, 10));
	}
	return keys;
}

export const SESSION_COLS = [
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
] as const;

export type SessionSummary = Pick<KlikapaDatabase["sessions"], (typeof SESSION_COLS)[number]>;

/**
 * D1 rejects a statement binding more than 100 parameters ("too many SQL
 * variables"), so every id list goes out in windows of this size — never as one
 * unbounded `IN (...)`.
 */
export const IN_CLAUSE_CHUNK = 50;

/**
 * The newest session per visitor for the given ids, skipping sessions whose
 * only events are custom/heartbeat noise. Ids arrive in chunks because
 * visitor_profiles scale to 100 and a single `visitor_id IN (...)` of that size
 * pushes the statement past D1's bound-parameter cap. Each visitor lands in
 * exactly one window, so first-seen wins per visitor; the result is re-sorted
 * newest-first to match the single-query ordering this replaces.
 */
export function planLatestSessionsForVisitors(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	visitorIds: string[],
): QueryPlan<SessionSummary[]> {
	const queries: Compilable<SessionSummary>[] = [];
	for (let i = 0; i < visitorIds.length; i += IN_CLAUSE_CHUNK) {
		queries.push(
			db
				.selectFrom("sessions")
				.select([...SESSION_COLS])
				.where("site_id", "=", siteId)
				.where("visitor_id", "in", visitorIds.slice(i, i + IN_CLAUSE_CHUNK))
				.where((eb) =>
					eb.exists(
						eb
							.selectFrom("events")
							.select("id")
							.where("site_id", "=", siteId)
							.whereRef("events.session_id", "=", "sessions.id")
							.where((ev) =>
								ev.or([ev("event_type", "!=", "custom"), ev("name", "is not", "heartbeat")]),
							),
					),
				)
				.orderBy("started_at", "desc"),
		);
	}
	return {
		queries,
		read(results) {
			const latest: SessionSummary[] = [];
			const seen = new Set<string>();
			for (const rows of results) {
				for (const row of rows as SessionSummary[]) {
					if (seen.has(row.visitor_id)) continue;
					seen.add(row.visitor_id);
					latest.push(row);
				}
			}
			return latest.sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
		},
	};
}

export function getLatestSessionsForVisitors(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	visitorIds: string[],
): Promise<SessionSummary[]> {
	return executePlan(db, planLatestSessionsForVisitors(db, siteId, visitorIds));
}

interface EventAgg {
	pageviews: unknown;
	visitors: unknown;
	revenue: unknown;
	conversions: unknown;
	is_current?: unknown;
}

interface SessionAgg {
	sessions: unknown;
	bounce: unknown;
	avg_duration: unknown;
	is_current?: unknown;
}

/**
 * With `splitIso`, rows are grouped by whether they fall at or after it, so one
 * scan over a window made of two adjacent periods yields both periods' totals.
 */
function eventStatsQuery(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	filters: ParsedFilter[] | undefined,
	endIso: string | undefined,
	scope: QueryScope,
	splitIso?: string,
): Compilable<EventAgg> {
	let q = db
		.selectFrom("events")
		.select([
			sql<number>`COUNT(CASE WHEN event_type = 'pageview' THEN 1 END)`.as("pageviews"),
			// Server-reported sales (external_id) belong to a buyer, not a site visit.
			sql<number>`COUNT(DISTINCT CASE WHEN external_id IS NULL THEN visitor_id END)`.as("visitors"),
			sql<number>`COALESCE(SUM(CASE WHEN revenue != 0 THEN ${revenueSql(scope.money)} END), 0)`.as(
				"revenue",
			),
			sql<number>`COUNT(CASE WHEN event_type = 'conversion' THEN 1 END)`.as("conversions"),
		])
		.where("site_id", "=", siteId)
		.where("timestamp", ">=", startIso);
	if (endIso) q = q.where("timestamp", "<", endIso);
	const filtered = applyFilters(q, filters);
	if (splitIso === undefined) return filtered;
	return filtered
		.select(sql<number>`${sql.ref("timestamp")} >= ${splitIso}`.as("is_current"))
		.groupBy(sql`${sql.ref("timestamp")} >= ${splitIso}`);
}

function sessionStatsQuery(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	filters: ParsedFilter[] | undefined,
	endIso: string | undefined,
	splitIso?: string,
): Compilable<SessionAgg> {
	let q = db
		.selectFrom("sessions")
		.select([
			({ fn }) => fn.count<number>("id").as("sessions"),
			({ fn }) => fn.avg<number>("is_bounce").as("bounce"),
			avgSessionSecondsSql.as("avg_duration"),
		])
		.where("site_id", "=", siteId)
		.where("started_at", ">=", startIso);
	if (endIso) q = q.where("started_at", "<", endIso);
	const filtered = applySessionFilters(q, { db, siteId, startIso, endIso }, filters);
	if (splitIso === undefined) return filtered;
	return filtered
		.select(sql<number>`${sql.ref("started_at")} >= ${splitIso}`.as("is_current"))
		.groupBy(sql`${sql.ref("started_at")} >= ${splitIso}`);
}

function toStats(ev: EventAgg | undefined, se: SessionAgg | undefined): StatsResponse {
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

const isCurrentRow = (r: { is_current?: unknown }) => Number(r.is_current) === 1;

export function getOverviewStats(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	filters?: ParsedFilter[],
	endIso?: string,
	scope: QueryScope = DEFAULT_SCOPE,
): Promise<StatsResponse> {
	return executePlan(db, {
		queries: [
			eventStatsQuery(db, siteId, startIso, filters, endIso, scope),
			sessionStatsQuery(db, siteId, startIso, filters, endIso),
		],
		read: ([ev, se]) => toStats((ev as EventAgg[])[0], (se as SessionAgg[])[0]),
	});
}

/** A window and the equally long one right before it (`prevStartIso` .. `startIso`). */
export interface ComparisonWindow {
	prevStartIso: string;
	startIso: string;
	endIso: string;
}

/**
 * Overview totals for a window and its predecessor from one scan of each table.
 * A `path` filter is a semi-join against the session's events bounded by the
 * window, so it can't be shared across the two periods and sessions fall back
 * to one statement per period.
 */
export function planOverviewComparison(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	w: ComparisonWindow,
	filters: ParsedFilter[] | undefined,
	scope: QueryScope,
): QueryPlan<{ current: StatsResponse; previous: StatsResponse }> {
	const events = eventStatsQuery(db, siteId, w.prevStartIso, filters, w.endIso, scope, w.startIso);
	if (filters?.some((f) => f.dimension === "path")) {
		return {
			queries: [
				events,
				sessionStatsQuery(db, siteId, w.startIso, filters, w.endIso),
				sessionStatsQuery(db, siteId, w.prevStartIso, filters, w.startIso),
			],
			read: ([ev, curSe, prevSe]) => {
				const evRows = ev as EventAgg[];
				return {
					current: toStats(evRows.find(isCurrentRow), (curSe as SessionAgg[])[0]),
					previous: toStats(
						evRows.find((r) => !isCurrentRow(r)),
						(prevSe as SessionAgg[])[0],
					),
				};
			},
		};
	}
	return {
		queries: [events, sessionStatsQuery(db, siteId, w.prevStartIso, filters, w.endIso, w.startIso)],
		read: ([ev, se]) => {
			const evRows = ev as EventAgg[];
			const seRows = se as SessionAgg[];
			return {
				current: toStats(evRows.find(isCurrentRow), seRows.find(isCurrentRow)),
				previous: toStats(
					evRows.find((r) => !isCurrentRow(r)),
					seRows.find((r) => !isCurrentRow(r)),
				),
			};
		},
	};
}

interface TimeseriesRow {
	date: unknown;
	pageviews: unknown;
	visitors: unknown;
	is_current?: unknown;
}

function fillTimeseries(rows: TimeseriesRow[], keys: string[]): TimeSeriesPoint[] {
	const byKey = new Map(rows.map((r) => [String(r.date ?? ""), r]));
	return keys.map((key) => {
		const row = byKey.get(key);
		return {
			date: key,
			pageviews: Number(row?.pageviews ?? 0),
			visitors: Number(row?.visitors ?? 0),
		};
	});
}

function timeseriesBase(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	isHourly: boolean,
	filters: ParsedFilter[] | undefined,
	endIso: string | undefined,
	scope: QueryScope,
) {
	let q = db
		.selectFrom("events")
		.select([
			bucketSql(isHourly, scope.tzOffset).as("date"),
			({ fn }) => fn.count<number>("id").as("pageviews"),
			({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors"),
		])
		.where("site_id", "=", siteId)
		.where("event_type", "=", "pageview")
		.where("timestamp", ">=", startIso);
	if (endIso) q = q.where("timestamp", "<", endIso);
	return applyFilters(q, filters);
}

export function getTimeseries(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	isHourly: boolean,
	filters?: ParsedFilter[],
	endIso?: string,
	scope: QueryScope = DEFAULT_SCOPE,
): Promise<TimeSeriesPoint[]> {
	return executePlan(
		db,
		queryPlan(
			timeseriesBase(db, siteId, startIso, isHourly, filters, endIso, scope)
				.groupBy(bucketSql(isHourly, scope.tzOffset))
				.orderBy("date", "asc"),
			(rows) => fillTimeseries(rows, bucketKeys(startIso, endIso, isHourly, scope.tzOffset)),
		),
	);
}

/**
 * Both periods' timeseries from one scan, split per bucket on `startIso` (the
 * bucket holding the boundary appears once per period, as in two separate queries).
 */
export function planTimeseriesComparison(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	w: ComparisonWindow,
	isHourly: boolean,
	filters: ParsedFilter[] | undefined,
	scope: QueryScope,
): QueryPlan<{ current: TimeSeriesPoint[]; previous: TimeSeriesPoint[] }> {
	return queryPlan(
		timeseriesBase(db, siteId, w.prevStartIso, isHourly, filters, w.endIso, scope)
			.select(sql<number>`${sql.ref("timestamp")} >= ${w.startIso}`.as("is_current"))
			.groupBy([
				bucketSql(isHourly, scope.tzOffset),
				sql`${sql.ref("timestamp")} >= ${w.startIso}`,
			]),
		(rows) => ({
			current: fillTimeseries(
				rows.filter(isCurrentRow),
				bucketKeys(w.startIso, w.endIso, isHourly, scope.tzOffset),
			),
			previous: fillTimeseries(
				rows.filter((r) => !isCurrentRow(r)),
				bucketKeys(w.prevStartIso, w.startIso, isHourly, scope.tzOffset),
			),
		}),
	);
}

export function planTopPages(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	limit: number,
	filters?: ParsedFilter[],
	endIso?: string,
): QueryPlan<TopPage[]> {
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

	return queryPlan(
		applyFilters(q, filters).groupBy("path").orderBy("pageviews", "desc").limit(limit),
		(pageRows) =>
			pageRows.map((r) => ({
				path: r.path,
				pageviews: Number(r.pageviews),
				visitors: Number(r.visitors),
			})),
	);
}

export function getTopPages(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	limit: number,
	filters?: ParsedFilter[],
	endIso?: string,
): Promise<TopPage[]> {
	return executePlan(db, planTopPages(db, siteId, startIso, limit, filters, endIso));
}

/**
 * Only pageviews carry a referrer; counting custom events (scroll, click) would
 * file every visitor under "direct" as well as their real source.
 */
export function planReferrers(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	limit: number,
	filters: ParsedFilter[] | undefined,
	endIso: string | undefined,
	siteDomain: string,
): QueryPlan<SourceEntry[]> {
	let q = db
		.selectFrom("events")
		.select([
			sourceSql.as("source"),
			({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors"),
		])
		.where("site_id", "=", siteId)
		.where("event_type", "=", "pageview")
		.where("timestamp", ">=", startIso)
		.where(externalReferrerOnly(siteDomain));
	if (endIso) q = q.where("timestamp", "<", endIso);

	return queryPlan(
		applyFilters(q, filters).groupBy(sourceSql).orderBy("visitors", "desc").limit(limit),
		(sourceRows) => {
			const totalSrc = sourceRows.reduce((s: number, r) => s + Number(r.visitors), 0);
			return sourceRows.map((r) => ({
				source: String(r.source),
				visitors: Number(r.visitors),
				percentage: totalSrc > 0 ? Math.round((Number(r.visitors) / totalSrc) * 100) : 0,
			}));
		},
	);
}

/** `siteDomain` skips the sites lookup when the caller already holds the site row. */
export async function getReferrers(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	limit: number,
	filters?: ParsedFilter[],
	endIso?: string,
	siteDomain?: string,
): Promise<SourceEntry[]> {
	const domain =
		siteDomain ??
		(await db.selectFrom("sites").select("domain").where("id", "=", siteId).executeTakeFirst())
			?.domain ??
		"";
	return executePlan(db, planReferrers(db, siteId, startIso, limit, filters, endIso, domain));
}

interface DeviceBreakdown {
	devices: DeviceEntry[];
	os: DeviceEntry[];
	browsers: DeviceEntry[];
}

type DeviceRow = { device: string; visitors: number | bigint };

function toDeviceEntries(rows: DeviceRow[]): DeviceEntry[] {
	const total = rows.reduce((s: number, r) => s + Number(r.visitors), 0);
	return rows.map((r) => ({
		device: String(r.device),
		visitors: Number(r.visitors),
		percentage: total > 0 ? Math.round((Number(r.visitors) / total) * 100) : 0,
	}));
}

export function planDeviceBreakdown(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	filters?: ParsedFilter[],
	endIso?: string,
): QueryPlan<DeviceBreakdown> {
	const grouped = (col: "device_type" | "os" | "browser") => {
		let q = db
			.selectFrom("sessions")
			.select([
				sql<string>`COALESCE(${sql.ref(col)}, 'unknown')`.as("device"),
				({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors"),
			])
			.where("site_id", "=", siteId)
			.where("started_at", ">=", startIso);
		if (endIso) q = q.where("started_at", "<", endIso);
		return applySessionFilters(q, { db, siteId, startIso, endIso }, filters)
			.groupBy(col)
			.orderBy("visitors", "desc")
			.limit(10);
	};

	return {
		queries: [grouped("device_type"), grouped("os"), grouped("browser")],
		read: ([deviceRows, osRows, browserRows]) => ({
			devices: toDeviceEntries(deviceRows as DeviceRow[]),
			os: toDeviceEntries(osRows as DeviceRow[]),
			browsers: toDeviceEntries(browserRows as DeviceRow[]),
		}),
	};
}

export function getDeviceBreakdown(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	filters?: ParsedFilter[],
	endIso?: string,
): Promise<DeviceBreakdown> {
	return executePlan(db, planDeviceBreakdown(db, siteId, startIso, filters, endIso));
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
		.where("external_id", "is", null)
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

export function planExitPages(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	filters?: ParsedFilter[],
	endIso?: string,
): QueryPlan<ExitPage[]> {
	const q = db
		.selectFrom("sessions")
		.select(["exit_path as path", ({ fn }) => fn.count<number>("id").as("exits")]);
	return queryPlan(
		applySessionFilters(q, { db, siteId, startIso, endIso }, filters)
			.groupBy("exit_path")
			.orderBy("exits", "desc")
			.limit(10),
		(rows) =>
			rows.map((r) => ({
				path: String(r.path ?? "/"),
				exits: Number(r.exits),
			})),
	);
}

export function getExitPages(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	filters?: ParsedFilter[],
	endIso?: string,
): Promise<ExitPage[]> {
	return executePlan(db, planExitPages(db, siteId, startIso, filters, endIso));
}

/**
 * Literal `revenue != 0`, not a bound parameter: only a literal lets the
 * planner use the partial revenue index.
 */
const hasRevenue = sql<boolean>`revenue != 0`;

export function planRevenueBySource(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	filters?: ParsedFilter[],
	endIso?: string,
	scope: QueryScope = DEFAULT_SCOPE,
): QueryPlan<RevenueBySource[]> {
	let q = db
		.selectFrom("events")
		.select([
			sourceSql.as("source"),
			sql<number>`SUM(${revenueSql(scope.money)})`.as("revenue"),
			sql<number>`COUNT(CASE WHEN revenue > 0 THEN 1 END)`.as("conversions"),
		])
		.where("site_id", "=", siteId)
		.where(hasRevenue)
		.where("timestamp", ">=", startIso);
	if (endIso) q = q.where("timestamp", "<", endIso);

	return queryPlan(
		applyFilters(q, filters).groupBy(sourceSql).orderBy("revenue", "desc").limit(10),
		(rows) =>
			rows.map((r) => ({
				source: String(r.source),
				revenue: Number(r.revenue ?? 0),
				conversions: Number(r.conversions ?? 0),
			})),
	);
}

export function getRevenueBySource(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	filters?: ParsedFilter[],
	endIso?: string,
	scope: QueryScope = DEFAULT_SCOPE,
): Promise<RevenueBySource[]> {
	return executePlan(db, planRevenueBySource(db, siteId, startIso, filters, endIso, scope));
}

export function planRevenueByCountry(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	filters?: ParsedFilter[],
	endIso?: string,
	scope: QueryScope = DEFAULT_SCOPE,
): QueryPlan<RevenueByCountry[]> {
	let q = db
		.selectFrom("events")
		.select([
			sql<string>`COALESCE(country, 'unknown')`.as("country"),
			sql<number>`SUM(${revenueSql(scope.money)})`.as("revenue"),
			sql<number>`COUNT(CASE WHEN revenue > 0 THEN 1 END)`.as("conversions"),
		])
		.where("site_id", "=", siteId)
		.where(hasRevenue)
		.where("timestamp", ">=", startIso);
	if (endIso) q = q.where("timestamp", "<", endIso);

	return queryPlan(
		applyFilters(q, filters).groupBy("country").orderBy("revenue", "desc").limit(10),
		(rows) =>
			rows.map((r) => ({
				country: String(r.country),
				revenue: Number(r.revenue ?? 0),
				conversions: Number(r.conversions ?? 0),
			})),
	);
}

export function getRevenueByCountry(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	filters?: ParsedFilter[],
	endIso?: string,
	scope: QueryScope = DEFAULT_SCOPE,
): Promise<RevenueByCountry[]> {
	return executePlan(db, planRevenueByCountry(db, siteId, startIso, filters, endIso, scope));
}

export function planRevenueTimeseries(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	isHourly: boolean,
	filters?: ParsedFilter[],
	endIso?: string,
	scope: QueryScope = DEFAULT_SCOPE,
): QueryPlan<RevenueTimeSeriesPoint[]> {
	let q = db
		.selectFrom("events")
		.select([
			bucketSql(isHourly, scope.tzOffset).as("date"),
			sql<number>`SUM(${revenueSql(scope.money)})`.as("revenue"),
			sql<number>`COUNT(CASE WHEN revenue > 0 THEN 1 END)`.as("conversions"),
		])
		.where("site_id", "=", siteId)
		.where(hasRevenue)
		.where("timestamp", ">=", startIso);
	if (endIso) q = q.where("timestamp", "<", endIso);

	return queryPlan(
		applyFilters(q, filters).groupBy(bucketSql(isHourly, scope.tzOffset)).orderBy("date", "asc"),
		(rows) => {
			const byKey = new Map(rows.map((r) => [String(r.date ?? ""), r]));
			return bucketKeys(startIso, endIso, isHourly, scope.tzOffset).map((key) => {
				const row = byKey.get(key);
				return {
					date: key,
					revenue: Number(row?.revenue ?? 0),
					conversions: Number(row?.conversions ?? 0),
				};
			});
		},
	);
}

export function getRevenueTimeseries(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	isHourly: boolean,
	filters?: ParsedFilter[],
	endIso?: string,
	scope: QueryScope = DEFAULT_SCOPE,
): Promise<RevenueTimeSeriesPoint[]> {
	return executePlan(
		db,
		planRevenueTimeseries(db, siteId, startIso, isHourly, filters, endIso, scope),
	);
}

export function planEntryPagesRevenue(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	filters?: ParsedFilter[],
	endIso?: string,
	scope: QueryScope = DEFAULT_SCOPE,
): QueryPlan<EntryPageRevenue[]> {
	let q = db
		.selectFrom("sessions")
		.innerJoin("events", "events.session_id", "sessions.id")
		.select([
			"sessions.entry_path as path",
			sql<number>`COUNT(DISTINCT sessions.id)`.as("sessions"),
			sql<number>`COUNT(DISTINCT CASE WHEN events.event_type = 'conversion' OR events.event_type = 'payment' THEN events.id END)`.as(
				"conversions",
			),
			sql<number>`COALESCE(SUM(CASE WHEN events.revenue != 0 THEN ${revenueSql(scope.money, "events.revenue", "events.currency")} END), 0)`.as(
				"revenue",
			),
		])
		.where("sessions.site_id", "=", siteId)
		.where("sessions.started_at", ">=", startIso)
		.where("events.site_id", "=", siteId);
	if (endIso) q = q.where("sessions.started_at", "<", endIso);

	return queryPlan(
		applyFilters(q, filters, "events")
			.groupBy("sessions.entry_path")
			.orderBy("revenue", "desc")
			.limit(20),
		(rows) =>
			rows.map((r) => ({
				path: String(r.path ?? "/"),
				sessions: Number(r.sessions),
				conversions: Number(r.conversions),
				revenue: Number(r.revenue),
			})),
	);
}

export function getEntryPagesRevenue(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	filters?: ParsedFilter[],
	endIso?: string,
	scope: QueryScope = DEFAULT_SCOPE,
): Promise<EntryPageRevenue[]> {
	return executePlan(db, planEntryPagesRevenue(db, siteId, startIso, filters, endIso, scope));
}

export function planRevenueByPaymentMethod(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	filters?: ParsedFilter[],
	endIso?: string,
	scope: QueryScope = DEFAULT_SCOPE,
): QueryPlan<RevenueByPaymentMethod[]> {
	let q = db
		.selectFrom("events")
		.select([
			sql<string>`COALESCE(payment_method, 'unknown')`.as("method"),
			sql<number>`COUNT(*)`.as("count"),
			sql<number>`COALESCE(SUM(${revenueSql(scope.money)}), 0)`.as("revenue"),
		])
		.where("site_id", "=", siteId)
		.where(hasRevenue)
		.where("timestamp", ">=", startIso);
	if (endIso) q = q.where("timestamp", "<", endIso);

	return queryPlan(
		applyFilters(q, filters).groupBy("payment_method").orderBy("revenue", "desc"),
		(rows) =>
			rows.map((r) => ({
				method: String(r.method),
				count: Number(r.count),
				revenue: Number(r.revenue),
			})),
	);
}

export function getRevenueByPaymentMethod(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	filters?: ParsedFilter[],
	endIso?: string,
	scope: QueryScope = DEFAULT_SCOPE,
): Promise<RevenueByPaymentMethod[]> {
	return executePlan(db, planRevenueByPaymentMethod(db, siteId, startIso, filters, endIso, scope));
}

export function planRevenueByPaymentProvider(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	filters?: ParsedFilter[],
	endIso?: string,
	scope: QueryScope = DEFAULT_SCOPE,
): QueryPlan<RevenueByPaymentProvider[]> {
	let q = db
		.selectFrom("events")
		.select([
			sql<string>`COALESCE(payment_provider, 'unknown')`.as("provider"),
			sql<number>`COUNT(*)`.as("count"),
			sql<number>`COALESCE(SUM(${revenueSql(scope.money)}), 0)`.as("revenue"),
		])
		.where("site_id", "=", siteId)
		.where(hasRevenue)
		.where("timestamp", ">=", startIso);
	if (endIso) q = q.where("timestamp", "<", endIso);

	return queryPlan(
		applyFilters(q, filters).groupBy("payment_provider").orderBy("revenue", "desc"),
		(rows) =>
			rows.map((r) => ({
				provider: String(r.provider),
				count: Number(r.count),
				revenue: Number(r.revenue),
			})),
	);
}

export function getRevenueByPaymentProvider(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	filters?: ParsedFilter[],
	endIso?: string,
	scope: QueryScope = DEFAULT_SCOPE,
): Promise<RevenueByPaymentProvider[]> {
	return executePlan(
		db,
		planRevenueByPaymentProvider(db, siteId, startIso, filters, endIso, scope),
	);
}

export function planChannelBreakdown(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	filters?: ParsedFilter[],
	endIso?: string,
	scope: QueryScope = DEFAULT_SCOPE,
): QueryPlan<ChannelEntry[]> {
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
			sql<number>`COALESCE(SUM(CASE WHEN revenue != 0 THEN ${revenueSql(scope.money)} END), 0)`.as(
				"revenue",
			),
		])
		.where("site_id", "=", siteId)
		.where("timestamp", ">=", startIso);
	if (endIso) q = q.where("timestamp", "<", endIso);

	return queryPlan(applyFilters(q, filters).groupBy(channelExpr), (rows) => {
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
	});
}

export function getChannelBreakdown(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	startIso: string,
	filters?: ParsedFilter[],
	endIso?: string,
	scope: QueryScope = DEFAULT_SCOPE,
): Promise<ChannelEntry[]> {
	return executePlan(db, planChannelBreakdown(db, siteId, startIso, filters, endIso, scope));
}

export interface DashboardRequest {
	siteId: string;
	siteDomain: string;
	window: ComparisonWindow;
	isHourly: boolean;
	filters: ParsedFilter[];
	scope: QueryScope;
}

/**
 * Every aggregate panel of the site dashboard plus the newest sessions and
 * visitor profiles in one D1 round trip. Current and previous period share
 * scans (see planOverviewComparison / planTimeseriesComparison).
 */
export async function loadDashboardData(
	d1: D1Database,
	db: Kysely<KlikapaDatabase>,
	r: DashboardRequest,
) {
	const { siteId, window: w, isHourly, filters, scope } = r;

	const recentSessionsQ = db
		.selectFrom("sessions")
		.select([...SESSION_COLS])
		.where("site_id", "=", siteId)
		.where("started_at", ">=", w.startIso)
		.where("started_at", "<", w.endIso);
	const recentSessions = queryPlan(
		applySessionFilters(
			recentSessionsQ,
			{ db, siteId, startIso: w.startIso, endIso: w.endIso },
			filters,
		)
			.orderBy("started_at", "desc")
			.limit(100),
		(rows): SessionSummary[] => rows,
	);

	const profiles = queryPlan(
		db
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
			// Same cap as GET /visitors so journey coverage matches the Users tab.
			.limit(100),
		(rows) => rows,
	);

	const [
		overview,
		series,
		topPages,
		sources,
		devices,
		recent,
		profileRows,
		revenueBySource,
		revenueByCountry,
		revenueTimeseries,
		entryPagesRevenue,
		exitPages,
		revenueByMethod,
		revenueByProvider,
		channels,
	] = await runBatch(d1, [
		planOverviewComparison(db, siteId, w, filters, scope),
		planTimeseriesComparison(db, siteId, w, isHourly, filters, scope),
		planTopPages(db, siteId, w.startIso, 10, filters, w.endIso),
		planReferrers(db, siteId, w.startIso, 10, filters, w.endIso, r.siteDomain),
		planDeviceBreakdown(db, siteId, w.startIso, filters, w.endIso),
		recentSessions,
		profiles,
		planRevenueBySource(db, siteId, w.startIso, filters, w.endIso, scope),
		planRevenueByCountry(db, siteId, w.startIso, filters, w.endIso, scope),
		planRevenueTimeseries(db, siteId, w.startIso, isHourly, filters, w.endIso, scope),
		planEntryPagesRevenue(db, siteId, w.startIso, filters, w.endIso, scope),
		planExitPages(db, siteId, w.startIso, filters, w.endIso),
		planRevenueByPaymentMethod(db, siteId, w.startIso, filters, w.endIso, scope),
		planRevenueByPaymentProvider(db, siteId, w.startIso, filters, w.endIso, scope),
		planChannelBreakdown(db, siteId, w.startIso, filters, w.endIso, scope),
	]);

	return {
		stats: overview.current,
		prevStats: overview.previous,
		timeseries: series.current,
		prevTimeseries: series.previous,
		topPages,
		sources,
		devices: devices.devices,
		os: devices.os,
		browsers: devices.browsers,
		recentSessions: recent,
		profiles: profileRows,
		revenueBySource,
		revenueByCountry,
		revenueTimeseries,
		entryPagesRevenue,
		exitPages,
		revenueByMethod,
		revenueByProvider,
		channels,
	};
}

export interface SessionEvent {
	session_id: string;
	path: string;
	event_type: string;
	name: string | null;
	timestamp: string;
	revenue: number | null;
	props: string | null;
}

function planSessionEvents(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	sessionIds: string[],
): QueryPlan<SessionEvent[]> {
	const queries: Compilable<SessionEvent>[] = [];
	for (let i = 0; i < sessionIds.length; i += IN_CLAUSE_CHUNK) {
		queries.push(
			db
				.selectFrom("events")
				.select(["session_id", "path", "event_type", "name", "timestamp", "revenue", "props"])
				.where("session_id", "in", sessionIds.slice(i, i + IN_CLAUSE_CHUNK))
				.where("site_id", "=", siteId)
				.orderBy("timestamp", "asc"),
		);
	}
	return { queries, read: (results) => results.flat() as SessionEvent[] };
}

/**
 * Journey inputs for the dashboard: the latest session of every profile the
 * newest-sessions window doesn't cover, and the events of all those sessions.
 * The recent sessions' events ride in the same batch as the backfill lookup, so
 * a dashboard whose profiles are all covered needs a single round trip here.
 */
export async function loadJourneyData(
	d1: D1Database,
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	recentSessions: SessionSummary[],
	missingVisitors: string[],
): Promise<{ backfillSessions: SessionSummary[]; eventsBySession: Map<string, SessionEvent[]> }> {
	const [backfillSessions, recentEvents] = await runBatch(d1, [
		planLatestSessionsForVisitors(db, siteId, missingVisitors),
		planSessionEvents(
			db,
			siteId,
			recentSessions.map((s) => s.id),
		),
	]);
	const [backfillEvents] =
		backfillSessions.length > 0
			? await runBatch(d1, [
					planSessionEvents(
						db,
						siteId,
						backfillSessions.map((s) => s.id),
					),
				])
			: [[] as SessionEvent[]];

	const eventsBySession = new Map<string, SessionEvent[]>();
	for (const e of [...recentEvents, ...backfillEvents]) {
		const list = eventsBySession.get(e.session_id);
		if (list) list.push(e);
		else eventsBySession.set(e.session_id, [e]);
	}
	return { backfillSessions, eventsBySession };
}
