import { sql } from "../db";
import { type MoneyContext, revenueSql } from "./fx";
import { clampTzOffset } from "./widget-live";

/**
 * The one place that says what RevKlik's numbers mean. Every surface that
 * reports them (dashboard, sites overview, public API, MCP, portfolio, widgets,
 * AI prompts) builds its SQL from these fragments, so a figure cannot drift
 * between screens.
 *
 *  - pageview:    an `events` row with event_type = 'pageview'.
 *  - visitor:     a distinct visitor_id with at least one pageview in the window.
 *                 Heartbeats, clicks, scrolls and server-reported sales never
 *                 make a visitor, so visitors can't outnumber the pageviews they
 *                 came from by more than one visitor per pageview.
 *  - session:     a `sessions` row whose started_at falls in the window.
 *  - conversion:  a sale (revenue > 0) or a zero-revenue goal event
 *                 (event_type = 'conversion'). A refund is never a conversion.
 *  - sale:        an event with revenue > 0.
 *  - revenue:     the signed sum of revenue != 0, converted to the display
 *                 currency (refunds subtract).
 *
 * Bot traffic and test/duplicate sales are removed for every read by
 * BotFilterPlugin, so none of the fragments mention them.
 *
 * Windows are half-open: `timestamp >= start AND timestamp < end`; an omitted
 * end means "up to now".
 */

/** `col` or `alias.col`, as a quoted reference. */
const ref = (prefix: string, column: string) => sql.ref(prefix ? `${prefix}.${column}` : column);

/** True for pageview rows. */
export const pageviewPredicate = (prefix = "") =>
	sql<boolean>`${ref(prefix, "event_type")} = 'pageview'`;

/** Sale or zero-revenue goal event. Refunds (revenue < 0) are not conversions. */
export const conversionPredicate = (prefix = "") =>
	sql<boolean>`(${ref(prefix, "revenue")} > 0 OR (${ref(prefix, "event_type")} = 'conversion' AND COALESCE(${ref(prefix, "revenue")}, 0) = 0))`;

/**
 * Literal `revenue != 0`, not a bound parameter: only a literal lets the
 * planner use the partial revenue index.
 */
export const hasRevenuePredicate = (prefix = "") => sql<boolean>`${ref(prefix, "revenue")} != 0`;

/** Pageview count (aggregate). */
export const pageviewsSql = (prefix = "") =>
	sql<number>`COUNT(CASE WHEN ${pageviewPredicate(prefix)} THEN 1 END)`;

/** Distinct pageview visitors (aggregate). */
export const visitorsSql = (prefix = "") =>
	sql<number>`COUNT(DISTINCT CASE WHEN ${pageviewPredicate(prefix)} THEN ${ref(prefix, "visitor_id")} END)`;

/** Conversion count (aggregate). */
export const conversionsSql = (prefix = "") =>
	sql<number>`COUNT(CASE WHEN ${conversionPredicate(prefix)} THEN 1 END)`;

/** Sale count (aggregate): events with revenue > 0. */
export const salesSql = (prefix = "") =>
	sql<number>`COUNT(CASE WHEN ${ref(prefix, "revenue")} > 0 THEN 1 END)`;

/** Signed revenue in the display currency; 0 when nothing carries revenue (aggregate). */
export const revenueTotalSql = (money: MoneyContext, prefix = "") =>
	sql<number>`COALESCE(SUM(CASE WHEN ${hasRevenuePredicate(prefix)} THEN ${revenueSql(
		money,
		prefix ? `${prefix}.revenue` : "revenue",
		prefix ? `${prefix}.currency` : "currency",
	)} END), 0)`;

/** A `tz` request value (east-positive minutes); absent or out of range cuts at UTC. */
export function tzOffsetFrom(raw: unknown): number {
	if (raw === undefined || raw === null || raw === "") return 0;
	return clampTzOffset(Number(raw)) ?? 0;
}

/**
 * Day or hour bucket in the caller's local time. `tzOffset` is east-positive
 * minutes (WIB = 420); 0 cuts at UTC. Keys look like `2026-10-30` (daily) or
 * `2026-10-30T07:00:00` (hourly).
 */
export function bucketSql(isHourly: boolean, tzOffset: number, column = "timestamp") {
	const col = sql.ref(column);
	if (tzOffset === 0) {
		return isHourly
			? sql<string>`strftime('%Y-%m-%dT%H:00:00', ${col})`
			: sql<string>`date(${col})`;
	}
	const shift = `${tzOffset >= 0 ? "+" : ""}${tzOffset} minutes`;
	return isHourly
		? sql<string>`strftime('%Y-%m-%dT%H:00:00', ${col}, ${shift})`
		: sql<string>`date(${col}, ${shift})`;
}

/** Day bucket in the caller's local time; same cut as the dashboard chart. */
export const dayBucketSql = (tzOffset: number, column = "timestamp") =>
	bucketSql(false, tzOffset, column);

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

const HOURLY_SPAN_MS = 48 * 3_600_000;

/** Ranges up to 48 h are charted by the hour, longer ones by the day. */
export const isHourlyRange = (start: Date, end: Date): boolean =>
	end.getTime() - start.getTime() <= HOURLY_SPAN_MS;

/**
 * The window right before `[start, end)`, the same length. Never clamped to the
 * plan's retention floor: the plan limits how far back a chart may reach, but a
 * period-over-period delta needs the previous window (raw rows are kept for
 * twice the plan window, see lib/purge.ts).
 */
export function previousWindowStart(start: Date, end: Date): string {
	return new Date(start.getTime() - (end.getTime() - start.getTime())).toISOString();
}

/** % change vs previous; null when previous = 0 and current > 0 (no baseline). */
export function pctChange(current: number, previous: number): number | null {
	if (previous === 0) return current === 0 ? 0 : null;
	return Math.round(((current - previous) / previous) * 100);
}
