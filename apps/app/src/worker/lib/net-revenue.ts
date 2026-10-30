import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { sql } from "../db";
import type { QueryPlan, QueryScope } from "../queries/analytics";
import { applyFilters, type ParsedFilter } from "./analytics-queries";
import { canonicalRail, defaultFeeRule, loadEffectiveFeeRules, netAfterRule } from "./fees";
import { convertAmount, revenueSql } from "./fx";
import { hasRevenuePredicate } from "./metrics";

/** A window and the equally long one right before it; `prevStartIso === startIso` means no baseline. */
export interface NetWindow {
	prevStartIso: string;
	startIso: string;
	endIso: string;
}

interface StoredRow {
	is_current: unknown;
	net: unknown;
}

interface UnpricedRow {
	is_current: unknown;
	own_rail: string | null;
	provider: string | null;
	cur: string;
	revenue: unknown;
	n: unknown;
}

export interface NetRows {
	stored: StoredRow[];
	unpriced: UnpricedRow[];
}

export interface NetRevenue {
	current: number;
	previous: number;
	/** True when part of the current window's net came from the owner's fee rule, not from the payment. */
	estimated: boolean;
}

const isCurrent = (r: { is_current: unknown }) => Number(r.is_current) === 1;

/**
 * Net revenue of a window and its predecessor, in the display currency. A row
 * stores the net its payment reported (or a fee rule's result at ingest); rows
 * written before nets existed are computed from the owner's fee rule at read
 * time and flagged `estimated`, exactly as the portfolio does.
 */
export function planNetRevenue(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	w: NetWindow,
	filters: ParsedFilter[] | undefined,
	scope: QueryScope,
): QueryPlan<NetRows> {
	const split = sql<number>`${sql.ref("timestamp")} >= ${w.startIso}`;
	const base = () =>
		db
			.selectFrom("events")
			.where("site_id", "=", siteId)
			.where(hasRevenuePredicate())
			.where("timestamp", ">=", w.prevStartIso)
			.where("timestamp", "<", w.endIso);

	const stored = applyFilters(
		base()
			.where("net_revenue", "is not", null)
			.select([
				split.as("is_current"),
				sql<number>`COALESCE(SUM(${revenueSql(scope.money, "net_revenue")}), 0)`.as("net"),
			]),
		filters,
	).groupBy(split);

	// Grouped by sign: the rule's percent applies to a sum, the fixed fee to each row.
	const unpriced = applyFilters(
		base()
			.where("net_revenue", "is", null)
			.select([
				split.as("is_current"),
				sql<string | null>`NULLIF(rail, '')`.as("own_rail"),
				sql<string | null>`NULLIF(payment_provider, '')`.as("provider"),
				sql<string>`UPPER(COALESCE(NULLIF(currency, ''), 'USD'))`.as("cur"),
				sql<number>`COALESCE(SUM(revenue), 0)`.as("revenue"),
				sql<number>`COUNT(*)`.as("n"),
			]),
		filters,
	).groupBy([
		split,
		sql`NULLIF(rail, '')`,
		sql`NULLIF(payment_provider, '')`,
		sql`UPPER(COALESCE(NULLIF(currency, ''), 'USD'))`,
		sql`revenue > 0`,
	]);

	return {
		queries: [stored, unpriced],
		read: ([storedRows, unpricedRows]) => ({
			stored: (storedRows ?? []) as StoredRow[],
			unpriced: (unpricedRows ?? []) as UnpricedRow[],
		}),
	};
}

/** Adds the fee-rule estimate for rows without a stored net; reads the owner's rules only when needed. */
export async function resolveNetRevenue(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	rows: NetRows,
	scope: QueryScope,
): Promise<NetRevenue> {
	let current = rows.stored.filter(isCurrent).reduce((s, r) => s + Number(r.net), 0);
	let previous = rows.stored.filter((r) => !isCurrent(r)).reduce((s, r) => s + Number(r.net), 0);
	if (rows.unpriced.length === 0) return { current, previous, estimated: false };

	const owner = await db
		.selectFrom("sites")
		.select("user_id")
		.where("id", "=", siteId)
		.executeTakeFirst();
	const rules = new Map(
		(owner ? (await loadEffectiveFeeRules(db, owner.user_id)).rules : []).map((r) => [r.rail, r]),
	);
	const { currency, rates } = scope.money;
	let estimated = false;
	for (const r of rows.unpriced) {
		const rail = canonicalRail(r.own_rail, r.provider);
		const rule = rules.get(rail) ?? defaultFeeRule(rail);
		const count = Number(r.n);
		const net = netAfterRule(
			Number(r.revenue),
			r.cur,
			{ ...rule, fixed_amount: rule.fixed_amount * count },
			rates,
		);
		const converted = convertAmount(net, r.cur, currency, rates);
		if (isCurrent(r)) {
			current += converted;
			estimated = true;
		} else previous += converted;
	}
	return { current, previous, estimated };
}
