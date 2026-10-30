import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { sql } from "../db";
import { canonicalRail, defaultFeeRule, netAfterRule, type FeeRule } from "./fees";
import { fxFactorSql, loadUsdRates, normalizeCurrency, type MoneyContext } from "./fx";
import { displayCurrency } from "./site-scope";

export interface PortfolioQuery {
	from?: string;
	to?: string;
	currency?: string;
}

export interface PortfolioTotals {
	gross: number;
	/** Net after fees: stored net where the row has one, else the owner's fee rule (see `estimated_rows`). */
	net: number;
	sales: number;
	refunds: number;
	refund_amount: number;
	/** Revenue rows with no stored net whose net was computed by fee rule at read time. */
	estimated_rows: number;
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
	by_rail: Array<{
		rail: string;
		gross: number;
		net: number;
		sales: number;
		estimated_rows: number;
	}>;
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
		/** "reported", "rule", "refund_ratio", or "estimated" when the row stores no net and the rule was applied now. */
		net_source: string;
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
 * one currency. Rails are canonical: a row without a rail takes the rail its
 * legacy payment_provider implies. A row stored without a net is never shown as
 * net = gross: its net is computed from the site owner's fee rule for its rail
 * and counted in `estimated_rows` (lib/revenue-backfill.ts stores them for good).
 */
export async function queryPortfolioRevenue(
	db: Kysely<KlikapaDatabase>,
	userId: string,
	query: PortfolioQuery,
	opts: { env?: { FX_USD_IDR?: string }; onlySiteId?: string | null } = {},
): Promise<PortfolioRevenue> {
	const range = resolvePortfolioRange(query);

	const [sites, rates] = await Promise.all([
		db
			.selectFrom("sites")
			.select(["id", "name", "revenue_currency", "user_id"])
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
			.execute(),
		loadUsdRates(db, opts.env),
	]);

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
		totals: { gross: 0, net: 0, sales: 0, refunds: 0, refund_amount: 0, estimated_rows: 0 },
		by_site: [],
		by_product: [],
		by_rail: [],
		daily: [],
		recent: [],
	};
	if (sites.length === 0) return empty;
	const siteNames = new Map(sites.map((s) => [s.id, s.name]));
	const siteIds = sites.map((s) => s.id);

	const ownRailExpr = sql<string | null>`NULLIF(events.rail, '')`;
	const providerExpr = sql<string | null>`NULLIF(events.payment_provider, '')`;
	const currencyExpr = sql<string>`UPPER(COALESCE(NULLIF(events.currency, ''), 'USD'))`;
	const dayExpr = sql<string>`substr(events.timestamp, 1, 10)`;

	const toRate = rates[money.currency] ?? 1;
	const fallbackFactor = Number.isFinite(toRate) ? toRate : 1;
	const factorFor = (code: string): number => {
		if (code === "USD" || !/^[A-Z]{3}$/.test(code)) return fallbackFactor;
		const rate = rates[code];
		if (rate === undefined) return fallbackFactor;
		const factor = toRate / rate;
		return Number.isFinite(factor) ? factor : fallbackFactor;
	};

	const base = () =>
		db
			.selectFrom("events")
			.where("events.site_id", "in", siteIds)
			.where(sql<boolean>`events.revenue != 0`)
			.where("events.is_bot", "=", 0)
			// Naming is_bot opts out of the plugin's filters, so exclusions are stated here.
			.where("events.excluded_reason", "is", null)
			.where("events.timestamp", ">=", range.startIso)
			.where("events.timestamp", "<", range.endIso);

	const [groups, recent, unpriced] = await Promise.all([
		base()
			.select([
				"events.site_id",
				"events.product",
				ownRailExpr.as("own_rail"),
				providerExpr.as("provider"),
				dayExpr.as("date"),
				currencyExpr.as("cur"),
				sql<number>`COALESCE(SUM(events.revenue), 0)`.as("gross"),
				sql<number>`COALESCE(SUM(events.net_revenue), 0)`.as("net"),
				sql<number>`COALESCE(SUM(CASE WHEN events.revenue > 0 THEN 1 ELSE 0 END), 0)`.as("sales"),
				sql<number>`COALESCE(SUM(CASE WHEN events.revenue < 0 THEN 1 ELSE 0 END), 0)`.as("refunds"),
				sql<number>`COALESCE(SUM(CASE WHEN events.revenue < 0 THEN -events.revenue ELSE 0 END), 0)`.as(
					"refund_raw",
				),
			])
			.groupBy([
				"events.site_id",
				"events.product",
				ownRailExpr,
				providerExpr,
				dayExpr,
				currencyExpr,
			])
			.execute(),
		base()
			.select([
				"events.id",
				"events.site_id",
				"events.product",
				"events.name",
				"events.revenue",
				"events.net_revenue",
				"events.net_source",
				"events.currency",
				"events.timestamp",
				ownRailExpr.as("own_rail"),
				providerExpr.as("provider"),
			])
			.orderBy("events.timestamp", "desc")
			.limit(RECENT_LIMIT)
			.execute(),
		// Rows with no stored net, grouped (sign apart) so the read stays small however many there are.
		base()
			.where("events.net_revenue", "is", null)
			.select([
				"events.site_id",
				"events.product",
				ownRailExpr.as("own_rail"),
				providerExpr.as("provider"),
				dayExpr.as("date"),
				currencyExpr.as("cur"),
				sql<number>`COALESCE(SUM(events.revenue), 0)`.as("revenue"),
				sql<number>`COUNT(*)`.as("n"),
			])
			.groupBy([
				"events.site_id",
				"events.product",
				ownRailExpr,
				providerExpr,
				dayExpr,
				currencyExpr,
				sql`events.revenue > 0`,
			])
			.execute(),
	]);

	// Fee rules of the owners behind the rows with no stored net, over the built-in defaults.
	const ownerOf = new Map(sites.map((s) => [s.id, s.user_id]));
	const owners = [
		...new Set(unpriced.map((r) => ownerOf.get(r.site_id)).filter(Boolean)),
	] as string[];
	const savedRules = new Map<string, FeeRule>();
	if (owners.length > 0) {
		const rows = await db
			.selectFrom("fee_rules")
			.select(["user_id", "rail", "percent_bps", "fixed_amount", "fixed_currency"])
			.where("user_id", "in", owners)
			.execute();
		for (const row of rows) savedRules.set(`${row.user_id}\u0000${row.rail}`, row);
	}
	/** Net of `count` rows summing to `revenue`: the percent applies to the sum, the fixed fee to each row. */
	const estimateNet = (
		siteId: string,
		rail: string,
		revenue: number,
		cur: string,
		count = 1,
	): number => {
		const rule = savedRules.get(`${ownerOf.get(siteId)}\u0000${rail}`) ?? defaultFeeRule(rail);
		return netAfterRule(revenue, cur, { ...rule, fixed_amount: rule.fixed_amount * count }, rates);
	};

	interface Acc {
		gross: number;
		net: number;
		sales: number;
		estimated: number;
	}
	const add = <K>(
		map: Map<K, Acc>,
		key: K,
		gross: number,
		net: number,
		sales: number,
		estimated = 0,
	) => {
		const acc = map.get(key);
		if (acc) {
			acc.gross += gross;
			acc.net += net;
			acc.sales += sales;
			acc.estimated += estimated;
		} else map.set(key, { gross, net, sales, estimated });
	};
	const totals = { gross: 0, net: 0, sales: 0, refunds: 0, refund_amount: 0, estimated_rows: 0 };
	const siteAcc = new Map<string, Acc>();
	const productAcc = new Map<string, Acc & { site_id: string; product: string | null }>();
	const railAcc = new Map<string, Acc>();
	const dayAcc = new Map<string, Acc>();
	for (const r of groups) {
		const f = factorFor(r.cur);
		const g = r.gross * f;
		const n = r.net * f;
		const rail = canonicalRail(r.own_rail, r.provider);
		totals.gross += g;
		totals.net += n;
		totals.sales += r.sales;
		totals.refunds += r.refunds;
		totals.refund_amount += r.refund_raw * f;
		add(siteAcc, r.site_id, g, n, r.sales);
		add(railAcc, rail, g, n, r.sales);
		add(dayAcc, r.date, g, n, r.sales);
		const pKey = `${r.site_id}\u0000${r.product ?? "\u0001null"}`;
		const p = productAcc.get(pKey);
		if (p) {
			p.gross += g;
			p.net += n;
			p.sales += r.sales;
		} else
			productAcc.set(pKey, {
				site_id: r.site_id,
				product: r.product,
				gross: g,
				net: n,
				sales: r.sales,
				estimated: 0,
			});
	}
	// Rows with no stored net: their gross is already counted above; add the rule's net.
	for (const r of unpriced) {
		const rail = canonicalRail(r.own_rail, r.provider);
		const n = estimateNet(r.site_id, rail, r.revenue, r.cur, r.n) * factorFor(r.cur);
		totals.net += n;
		totals.estimated_rows += r.n;
		add(siteAcc, r.site_id, 0, n, 0, r.n);
		add(railAcc, rail, 0, n, 0, r.n);
		add(dayAcc, r.date, 0, n, 0, r.n);
		const pKey = `${r.site_id}\u0000${r.product ?? "\u0001null"}`;
		const p = productAcc.get(pKey);
		if (p) p.net += n;
		else
			productAcc.set(pKey, {
				site_id: r.site_id,
				product: r.product,
				gross: 0,
				net: n,
				sales: 0,
				estimated: r.n,
			});
	}

	const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
	const name = (siteId: string) => siteNames.get(siteId) ?? siteId;
	return {
		...empty,
		totals,
		by_site: [...siteAcc.entries()]
			.sort((a, b) => cmp(a[0], b[0]))
			.map(([site_id, v]) => ({
				site_id,
				site_name: name(site_id),
				gross: v.gross,
				net: v.net,
				sales: v.sales,
			}))
			.sort((a, b) => b.gross - a.gross),
		by_product: [...productAcc.values()]
			.sort(
				(a, b) =>
					cmp(a.site_id, b.site_id) ||
					cmp(a.product ?? "", b.product ?? "") ||
					(a.product === null ? -1 : 0) - (b.product === null ? -1 : 0),
			)
			.map((v) => ({
				product: v.product,
				site_id: v.site_id,
				site_name: name(v.site_id),
				gross: v.gross,
				net: v.net,
				sales: v.sales,
			}))
			.sort((a, b) => b.gross - a.gross),
		by_rail: [...railAcc.entries()]
			.sort((a, b) => cmp(a[0], b[0]))
			.map(([rail, v]) => ({
				rail,
				gross: v.gross,
				net: v.net,
				sales: v.sales,
				estimated_rows: v.estimated,
			}))
			.sort((a, b) => b.gross - a.gross),
		daily: [...dayAcc.entries()]
			.sort((a, b) => cmp(a[0], b[0]))
			.map(([date, v]) => ({ date, gross: v.gross, net: v.net, sales: v.sales })),
		recent: recent.map((r) => {
			const cur = String(r.currency || "USD").toUpperCase();
			const f = factorFor(cur);
			const rail = canonicalRail(r.own_rail, r.provider);
			const stored = r.net_revenue !== null;
			const net = stored ? (r.net_revenue ?? 0) : estimateNet(r.site_id, rail, r.revenue ?? 0, cur);
			return {
				event_id: r.id,
				site_id: r.site_id,
				site_name: name(r.site_id),
				product: r.product,
				rail,
				name: r.name,
				revenue: r.revenue ?? 0,
				net_revenue: net,
				net_source: stored ? (r.net_source ?? "rule") : "estimated",
				currency: r.currency ?? "USD",
				converted_gross: (r.revenue ?? 0) * f,
				converted_net: net * f,
				occurred_at: r.timestamp,
			};
		}),
	};
}
