import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { sql } from "../db";
import { fxFactorSql, loadUsdRates, normalizeCurrency, type MoneyContext } from "./fx";
import { displayCurrency } from "./site-scope";

export interface PortfolioQuery {
	from?: string;
	to?: string;
	currency?: string;
}

export interface PortfolioTotals {
	gross: number;
	net: number;
	sales: number;
	refunds: number;
	refund_amount: number;
}

export interface PortfolioRevenue {
	currency: string;
	from: string;
	to: string;
	totals: PortfolioTotals;
	by_site: Array<{ site_id: string; site_name: string; gross: number; net: number; sales: number }>;
	by_product: Array<{
		product: string | null;
		site_id: string;
		site_name: string;
		gross: number;
		net: number;
		sales: number;
	}>;
	by_rail: Array<{ rail: string; gross: number; net: number; sales: number }>;
	daily: Array<{ date: string; gross: number; net: number; sales: number }>;
	recent: Array<{
		event_id: string;
		site_id: string;
		site_name: string;
		product: string | null;
		rail: string;
		name: string | null;
		revenue: number;
		net_revenue: number;
		currency: string;
		converted_gross: number;
		converted_net: number;
		occurred_at: string;
	}>;
}

/** Raised for a malformed query; routes map it to HTTP 400. */
export class PortfolioQueryError extends Error {}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_RANGE_DAYS = 30;
const MS_PER_DAY = 86_400_000;
const RECENT_LIMIT = 20;

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

function parseDay(value: string, field: string): number {
	const ms = DATE_RE.test(value) ? Date.parse(`${value}T00:00:00Z`) : Number.NaN;
	if (!Number.isFinite(ms)) throw new PortfolioQueryError(`${field} must be YYYY-MM-DD`);
	return ms;
}

/** Inclusive UTC day range; defaults to the last 30 days ending today. */
export function resolvePortfolioRange(
	q: PortfolioQuery,
	nowMs = Date.now(),
): { from: string; to: string; startIso: string; endIso: string } {
	const toMs = q.to ? parseDay(q.to, "to") : parseDay(isoDay(nowMs), "to");
	const fromMs = q.from ? parseDay(q.from, "from") : toMs - (DEFAULT_RANGE_DAYS - 1) * MS_PER_DAY;
	if (fromMs > toMs) throw new PortfolioQueryError("from must not be after to");
	return {
		from: isoDay(fromMs),
		to: isoDay(toMs),
		startIso: new Date(fromMs).toISOString(),
		endIso: new Date(toMs + MS_PER_DAY).toISOString(),
	};
}

/**
 * Cross-site revenue of everything the user owns or accepted a team seat on
 * (or only `onlySiteId` for a site-bound token), converted at query time into
 * one currency. Net falls back to gross for rows stored before fee tracking.
 */
export async function queryPortfolioRevenue(
	db: Kysely<KlikapaDatabase>,
	userId: string,
	query: PortfolioQuery,
	opts: { env?: { FX_USD_IDR?: string }; onlySiteId?: string | null } = {},
): Promise<PortfolioRevenue> {
	const range = resolvePortfolioRange(query);

	const sites = await db
		.selectFrom("sites")
		.select(["id", "name", "revenue_currency"])
		.where((eb) =>
			eb.or([
				eb("user_id", "=", userId),
				eb.exists(
					eb
						.selectFrom("team_members")
						.select("team_members.id")
						.whereRef("team_members.site_id", "=", "sites.id")
						.where("team_members.user_id", "=", userId)
						.where("team_members.accepted_at", "is not", null),
				),
			]),
		)
		.$if(!!opts.onlySiteId, (qb) => qb.where("id", "=", opts.onlySiteId as string))
		.execute();

	const rates = await loadUsdRates(db, opts.env);
	const requested = query.currency ? normalizeCurrency(query.currency) : null;
	if (query.currency && !requested)
		throw new PortfolioQueryError("currency must be a 3-letter code");
	const counts = new Map<string, number>();
	for (const s of sites) {
		const code = normalizeCurrency(s.revenue_currency);
		if (code) counts.set(code, (counts.get(code) ?? 0) + 1);
	}
	const mostCommon = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
	const money: MoneyContext = { currency: displayCurrency(requested ?? mostCommon, rates), rates };

	const empty: PortfolioRevenue = {
		currency: money.currency,
		from: range.from,
		to: range.to,
		totals: { gross: 0, net: 0, sales: 0, refunds: 0, refund_amount: 0 },
		by_site: [],
		by_product: [],
		by_rail: [],
		daily: [],
		recent: [],
	};
	if (sites.length === 0) return empty;
	const siteNames = new Map(sites.map((s) => [s.id, s.name]));
	const siteIds = sites.map((s) => s.id);

	const fx = fxFactorSql(money, "events.currency");
	const gross = sql<number>`(events.revenue * ${fx})`;
	const net = sql<number>`(COALESCE(events.net_revenue, events.revenue) * ${fx})`;
	const railExpr = sql<string>`COALESCE(NULLIF(events.rail, ''), NULLIF(events.payment_provider, ''), 'other')`;

	const base = () =>
		db
			.selectFrom("events")
			.where("events.site_id", "in", siteIds)
			.where("events.revenue", "!=", 0)
			.where("events.is_bot", "=", 0)
			.where("events.timestamp", ">=", range.startIso)
			.where("events.timestamp", "<", range.endIso);

	const sums = () => [
		sql<number>`COALESCE(SUM(${gross}), 0)`.as("gross"),
		sql<number>`COALESCE(SUM(${net}), 0)`.as("net"),
		sql<number>`COALESCE(SUM(CASE WHEN events.revenue > 0 THEN 1 ELSE 0 END), 0)`.as("sales"),
	];

	const [totals, bySite, byProduct, byRail, daily, recent] = await Promise.all([
		base()
			.select([
				...sums(),
				sql<number>`COALESCE(SUM(CASE WHEN events.revenue < 0 THEN 1 ELSE 0 END), 0)`.as("refunds"),
				sql<number>`COALESCE(SUM(CASE WHEN events.revenue < 0 THEN -${gross} ELSE 0 END), 0)`.as(
					"refund_amount",
				),
			])
			.executeTakeFirst(),
		base()
			.select(["events.site_id", ...sums()])
			.groupBy("events.site_id")
			.execute(),
		base()
			.select(["events.site_id", "events.product", ...sums()])
			.groupBy(["events.site_id", "events.product"])
			.execute(),
		base()
			.select([railExpr.as("rail"), ...sums()])
			.groupBy(railExpr)
			.execute(),
		base()
			.select([sql<string>`substr(events.timestamp, 1, 10)`.as("date"), ...sums()])
			.groupBy(sql`substr(events.timestamp, 1, 10)`)
			.orderBy("date")
			.execute(),
		base()
			.select([
				"events.id",
				"events.site_id",
				"events.product",
				"events.name",
				"events.revenue",
				"events.net_revenue",
				"events.currency",
				"events.timestamp",
				railExpr.as("rail"),
				gross.as("converted_gross"),
				net.as("converted_net"),
			])
			.orderBy("events.timestamp", "desc")
			.limit(RECENT_LIMIT)
			.execute(),
	]);

	const name = (siteId: string) => siteNames.get(siteId) ?? siteId;
	return {
		...empty,
		totals: totals
			? {
					gross: totals.gross,
					net: totals.net,
					sales: totals.sales,
					refunds: totals.refunds,
					refund_amount: totals.refund_amount,
				}
			: empty.totals,
		by_site: bySite
			.map((r) => ({
				site_id: r.site_id,
				site_name: name(r.site_id),
				gross: r.gross,
				net: r.net,
				sales: r.sales,
			}))
			.sort((a, b) => b.gross - a.gross),
		by_product: byProduct
			.map((r) => ({
				product: r.product,
				site_id: r.site_id,
				site_name: name(r.site_id),
				gross: r.gross,
				net: r.net,
				sales: r.sales,
			}))
			.sort((a, b) => b.gross - a.gross),
		by_rail: byRail
			.map((r) => ({ rail: r.rail, gross: r.gross, net: r.net, sales: r.sales }))
			.sort((a, b) => b.gross - a.gross),
		daily: daily.map((r) => ({ date: r.date, gross: r.gross, net: r.net, sales: r.sales })),
		recent: recent.map((r) => ({
			event_id: r.id,
			site_id: r.site_id,
			site_name: name(r.site_id),
			product: r.product,
			rail: r.rail,
			name: r.name,
			revenue: r.revenue ?? 0,
			net_revenue: r.net_revenue ?? r.revenue ?? 0,
			currency: r.currency ?? "USD",
			converted_gross: r.converted_gross,
			converted_net: r.converted_net,
			occurred_at: r.timestamp,
		})),
	};
}
