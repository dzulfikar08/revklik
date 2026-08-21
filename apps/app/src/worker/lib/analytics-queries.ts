import type { Kysely, SelectQueryBuilder } from "kysely";
import type { HeatmapData, KlikapaDatabase } from "@revklik/shared";

/**
 * Validate that a user has access to a site (owns it or is an accepted team member).
 */
export function validateSite(
	db: Kysely<KlikapaDatabase>,
	userId: string,
	siteId: string,
) {
	return db
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
			(f) =>
				f.dimension &&
				(f.value || f.operator === "exists" || f.operator === "not_exists"),
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
]);

export function applyFilters<DB, TB extends keyof DB, O>(
	qb: SelectQueryBuilder<DB, TB, O>,
	filters?: ParsedFilter[],
	alias?: string,
): SelectQueryBuilder<DB, TB, O> {
	if (!filters || filters.length === 0) return qb;
	const col = (dim: string) => (alias ? `${alias}.${dim}` : dim);
	for (const f of filters) {
		if (!VALID_DIMENSIONS.has(f.dimension)) continue;
		const c = col(f.dimension);
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
			qb = qb.where((eb) => eb.or([eb(c as never, "is", null as never), eb(c as never, "=", "" as never)]));
		}
	}
	return qb;
}

/**
 * Convert an array of row objects to a CSV string using the given column order.
 */
export function toCsv(
	rows: Record<string, unknown>[],
	columns: string[],
): string {
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
export function buildFunnelSteps(
	secMap: Map<string, Set<string>>,
	totalVis: number,
): FunnelStep[] {
	const sorted = [...secMap.entries()].sort((a, b) => b[1].size - a[1].size);
	return sorted.map(([section, visitors], i, arr) => {
		const prevVisitors = i === 0 ? totalVis : (arr[i - 1]?.[1].size ?? 0);
		return {
			section,
			visitors: visitors.size,
			percentage:
				totalVis > 0 ? Math.round((visitors.size / totalVis) * 100) : 0,
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
export function buildDepthSteps(
	visitorDepths: Map<string, number>,
	total: number,
): FunnelStep[] {
	const depthBuckets = [25, 50, 75, 90];
	const depthCounts = new Map<number, number>();
	for (const [, maxDepth] of visitorDepths) {
		for (const bucket of depthBuckets) {
			if (maxDepth >= bucket)
				depthCounts.set(bucket, (depthCounts.get(bucket) ?? 0) + 1);
		}
	}
	return depthBuckets
		.filter((d) => (depthCounts.get(d) ?? 0) > 0)
		.map((d, i, arr) => {
			const visitors = depthCounts.get(d) ?? 0;
			const prevVisitors =
				i === 0 ? total : (depthCounts.get(arr[i - 1] ?? 0) ?? total);
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
				if (!sectionVisitors.has(section))
					sectionVisitors.set(section, new Set());
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
	const elemMap: Record<
		string,
		{ selector: string; clicks: number; label: string }
	> = {};

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
	const depthBuckets: Record<number, { depth: number; visitors: Set<string> }> =
		{};
	for (let d = 0; d <= 100; d += 10)
		depthBuckets[d] = { depth: d, visitors: new Set<string>() };
	for (const row of scrollRows) {
		const d = Math.min(
			100,
			Math.max(0, Math.round(Number(row.max_scroll) / 10) * 10),
		);
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
