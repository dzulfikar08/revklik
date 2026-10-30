import type { Kysely, RawBuilder, SelectQueryBuilder } from "kysely";
import type { HeatmapData, KlikapaDatabase } from "@revklik/shared";
import { sql } from "../db";
import { loadAccess, type SiteAccess } from "./site-access";
import { computedSourceSql } from "./source-sql";

/**
 * Validate that a user has access to a site (owns it or is an accepted team member).
 * Shares one read per request with the plan gates and the query scope.
 */
export async function validateSite(
	db: Kysely<KlikapaDatabase>,
	userId: string,
	siteId: string,
): Promise<SiteAccess | undefined> {
	const { site } = await loadAccess(db, userId, siteId);
	return site?.canAccess ? site : undefined;
}

/**
 * Parse filter params from query string: filters=country:is:ID,device_type:is_not:Mobile
 */
export function parseFilters(
	query: string,
): { dimension: string; operator: string; value: string }[] {
	if (!query) return [];
	return query
		.split(",")
		.map((f) => {
			const [dimension, operator, ...rest] = f.split(":");
			return {
				dimension: dimension ?? "",
				operator: operator ?? "is",
				value: rest.join(":"),
			};
		})
		.filter(
			(f) => f.dimension && (f.value || f.operator === "exists" || f.operator === "not_exists"),
		);
}

export type ParsedFilter = {
	dimension: string;
	operator: string;
	value: string;
};

/**
 * Apply parsed filters to a Kysely query builder.
 */
const VALID_DIMENSIONS = new Set([
	"path",
	"country",
	"region",
	"city",
	"device_type",
	"browser",
	"os",
	"referrer",
	"utm_source",
	"utm_medium",
	"utm_campaign",
	"source",
	"payment_method",
	"payment_provider",
]);

/** Dimensions that exist on `events` only; sessions reach them through a semi-join. */
const EVENT_ONLY_DIMENSIONS: readonly string[] = ["path", "payment_method", "payment_provider"];

/** True when a session query needs a semi-join against events for this filter set. */
export function hasEventOnlyFilter(filters: ParsedFilter[] | undefined): boolean {
	return filters?.some((f) => EVENT_ONLY_DIMENSIONS.includes(f.dimension)) ?? false;
}

/**
 * Canonical traffic source of a row, the same label the Sources and
 * revenue-by-source panels group by: the stamped `source`, else computed from
 * utm_source / referrer / browser. In a joined query (`alias` set) both tables
 * carry those columns, so only the stamped value of the named table is used;
 * ingest stamps every row and the v17 backfill covers older ones.
 */
function sourceColumn(alias?: string): RawBuilder<string> {
	return alias
		? sql<string>`${sql.ref(`${alias}.source`)}`
		: sql<string>`COALESCE(${sql.ref("source")}, ${computedSourceSql})`;
}

export function applyFilters<DB, TB extends keyof DB, O>(
	qb: SelectQueryBuilder<DB, TB, O>,
	filters?: ParsedFilter[],
	alias?: string,
	skip: readonly string[] = [],
): SelectQueryBuilder<DB, TB, O> {
	if (!filters || filters.length === 0) return qb;
	const col = (dim: string) => (alias ? `${alias}.${dim}` : dim);
	for (const f of filters) {
		if (!VALID_DIMENSIONS.has(f.dimension)) continue;
		// Dimension not present on this table (e.g. "path" on sessions) —
		// D1 would silently treat the quoted identifier as a string literal.
		if (skip.includes(f.dimension)) continue;
		const c = f.dimension === "source" ? sourceColumn(alias) : col(f.dimension);
		if (f.operator === "is") {
			qb = qb.where(c as never, "=", f.value as never);
		} else if (f.operator === "is_not") {
			qb = qb.where(c as never, "!=", f.value as never);
		} else if (f.operator === "contains") {
			qb = qb.where(c as never, "like", `%${f.value}%` as never);
		} else if (f.operator === "not_contains") {
			qb = qb.where(c as never, "not like", `%${f.value}%` as never);
		} else if (f.operator === "starts_with") {
			qb = qb.where(c as never, "like", `${f.value}%` as never);
		} else if (f.operator === "exists") {
			qb = qb.where(c as never, "is not", null as never).where(c as never, "!=", "" as never);
		} else if (f.operator === "not_exists") {
			qb = qb.where((eb) =>
				eb.or([eb(c as never, "is", null as never), eb(c as never, "=", "" as never)]),
			);
		}
	}
	return qb;
}

interface SessionScope {
	db: Kysely<KlikapaDatabase>;
	siteId: string;
	startIso: string;
	endIso?: string;
}

/**
 * Apply parsed filters to a sessions query. Sessions carry every dimension
 * except `path` and the payment ones; those are honoured through a semi-join
 * against the session's events, so "path:is:/pricing" narrows session-derived
 * panels to sessions that actually had a pageview on that path.
 */
export function applySessionFilters<DB, TB extends keyof DB, O>(
	qb: SelectQueryBuilder<DB, TB, O>,
	scope: SessionScope,
	filters?: ParsedFilter[],
): SelectQueryBuilder<DB, TB, O> {
	if (!filters || filters.length === 0) return qb;
	const eventFilters = filters.filter((f) => EVENT_ONLY_DIMENSIONS.includes(f.dimension));
	let out = applyFilters(
		qb,
		filters.filter((f) => !EVENT_ONLY_DIMENSIONS.includes(f.dimension)),
	);
	for (const f of eventFilters) {
		out = out.where((eb) => {
			let sq = scope.db
				.selectFrom("events")
				.select("events.session_id")
				.where("events.site_id", "=", scope.siteId)
				.where("events.timestamp", ">=", scope.startIso);
			if (scope.endIso) {
				sq = sq.where("events.timestamp", "<", scope.endIso);
			}
			sq = applyFilters(sq, [f], "events");
			return eb("sessions.id" as never, "in", sq as never);
		});
	}
	return out;
}

/**
 * Convert an array of row objects to a CSV string using the given column order.
 */
export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
	const esc = (v: unknown) => {
		const s = v === null || v === undefined ? "" : String(v);
		return s.includes(",") || s.includes('"') || s.includes("\n")
			? `"${s.replace(/"/g, '""')}"`
			: s;
	};
	return [columns.join(","), ...rows.map((r) => columns.map((c) => esc(r[c])).join(","))].join(
		"\n",
	);
}

// --- Funnel helpers ---

export interface FunnelStep {
	section: string;
	visitors: number;
	percentage: number;
	dropoff: number;
}

export interface PageFunnel {
	path: string;
	steps: FunnelStep[];
	totalVisitors: number;
	conversionRate: number;
}

/**
 * Build funnel steps from a section->visitors map, sorted by visitor count descending.
 */
export function buildFunnelSteps(secMap: Map<string, Set<string>>, totalVis: number): FunnelStep[] {
	const sorted = [...secMap.entries()].sort((a, b) => b[1].size - a[1].size);
	return sorted.map(([section, visitors], i, arr) => {
		const prevVisitors = i === 0 ? totalVis : (arr[i - 1]?.[1].size ?? 0);
		return {
			section,
			visitors: visitors.size,
			percentage: totalVis > 0 ? Math.round((visitors.size / totalVis) * 100) : 0,
			dropoff:
				i > 0 && prevVisitors > 0
					? Math.round(((prevVisitors - visitors.size) / prevVisitors) * 100)
					: 0,
		};
	});
}

/**
 * Build depth-based funnel steps from visitor scroll depth percentages.
 */
export function buildDepthSteps(visitorDepths: Map<string, number>, total: number): FunnelStep[] {
	const depthBuckets = [25, 50, 75, 90];
	const depthCounts = new Map<number, number>();
	for (const [, maxDepth] of visitorDepths) {
		for (const bucket of depthBuckets) {
			if (maxDepth >= bucket) depthCounts.set(bucket, (depthCounts.get(bucket) ?? 0) + 1);
		}
	}
	return depthBuckets
		.filter((d) => (depthCounts.get(d) ?? 0) > 0)
		.map((d, i, arr) => {
			const visitors = depthCounts.get(d) ?? 0;
			const prevVisitors = i === 0 ? total : (depthCounts.get(arr[i - 1] ?? 0) ?? total);
			return {
				section: `${d}%`,
				visitors,
				percentage: total > 0 ? Math.round((visitors / total) * 100) : 0,
				dropoff:
					i > 0 && prevVisitors > 0
						? Math.round(((prevVisitors - visitors) / prevVisitors) * 100)
						: 0,
			};
		});
}

/**
 * Process scroll events into per-page and global section/depth visitor maps.
 */
export function processScrollEvents(
	scrollEvents: {
		visitor_id: string | null;
		name: string | null;
		props: string | null;
		path: string | null;
	}[],
): {
	pageSectionVisitors: Map<string, Map<string, Set<string>>>;
	sectionVisitors: Map<string, Set<string>>;
	visitorDepths: Map<string, number>;
} {
	const pageSectionVisitors = new Map<string, Map<string, Set<string>>>();
	const visitorDepths = new Map<string, number>();
	const sectionVisitors = new Map<string, Set<string>>();

	for (const ev of scrollEvents) {
		try {
			const p = JSON.parse(ev.props ?? "{}");
			if (p.section && ev.visitor_id && ev.path) {
				const section = String(p.section);
				let pageMap = pageSectionVisitors.get(ev.path);
				if (!pageMap) {
					pageMap = new Map();
					pageSectionVisitors.set(ev.path, pageMap);
				}
				if (!pageMap.has(section)) pageMap.set(section, new Set());
				pageMap.get(section)?.add(ev.visitor_id);
				if (!sectionVisitors.has(section)) sectionVisitors.set(section, new Set());
				sectionVisitors.get(section)?.add(ev.visitor_id);
			}
			if (p.depth && ev.visitor_id) {
				const d = Number(p.depth);
				const prev = visitorDepths.get(ev.visitor_id) ?? 0;
				if (d > prev) visitorDepths.set(ev.visitor_id, d);
			}
		} catch {
			/* skip */
		}
	}

	return { pageSectionVisitors, sectionVisitors, visitorDepths };
}

// --- Heatmap helpers ---

/**
 * Build heatmap data from raw click and scroll rows fetched from the database.
 */
export function buildHeatmapData(
	clickRows: {
		x: number | string;
		y: number | string;
		element_selector: string | null;
		element_text: string | null;
		visitor_id: string;
	}[],
	scrollRows: { max_scroll: number | string; visitor_id: string }[],
	sessionCount: number,
): HeatmapData {
	// Build 50x50 click grid (2% buckets)
	const grid: number[][] = Array.from({ length: 50 }, () => Array(50).fill(0));
	const elemMap: Record<string, { selector: string; clicks: number; label: string }> = {};

	for (const row of clickRows) {
		const bx = Math.min(49, Math.max(0, Math.floor(Number(row.x) / 2)));
		const by = Math.min(49, Math.max(0, Math.floor(Number(row.y) / 2)));
		const gridRow = grid[by];
		if (gridRow) gridRow[bx] = (gridRow[bx] ?? 0) + 1;
		if (row.element_selector) {
			const key = row.element_selector;
			let entry = elemMap[key];
			if (!entry) {
				entry = {
					selector: key,
					clicks: 0,
					label: row.element_text || key,
				};
				elemMap[key] = entry;
			}
			entry.clicks++;
		}
	}

	const topElements = Object.values(elemMap)
		.sort((a, b) => b.clicks - a.clicks)
		.slice(0, 20);

	// Build scroll depth distribution
	const depthBuckets: Record<number, { depth: number; visitors: Set<string> }> = {};
	for (let d = 0; d <= 100; d += 10) depthBuckets[d] = { depth: d, visitors: new Set<string>() };
	for (const row of scrollRows) {
		const d = Math.min(100, Math.max(0, Math.round(Number(row.max_scroll) / 10) * 10));
		depthBuckets[d]?.visitors.add(row.visitor_id);
	}
	const scrollDepths = Object.values(depthBuckets).map((b) => ({
		depth: b.depth,
		visitors: b.visitors.size,
	}));

	return {
		clickGrid: grid,
		scrollDepths,
		totalSessions: sessionCount,
		totalClicks: clickRows.length,
		topElements,
	};
}
