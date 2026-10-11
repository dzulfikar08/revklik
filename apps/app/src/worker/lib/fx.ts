import { sql, type RawBuilder } from "kysely";

/**
 * Static FX table, units of each currency per 1 USD. Approximate on purpose:
 * it only has to make mixed-currency totals comparable, not settle money.
 * IDR follows env FX_USD_IDR so the dominant non-USD currency can be tuned
 * without a deploy of new code.
 */
const STATIC_USD_RATES: Record<string, number> = {
	USD: 1,
	EUR: 0.92,
	SGD: 1.35,
	MYR: 4.7,
};

export const DEFAULT_USD_IDR = 16_000;

export type FxRates = Readonly<Record<string, number>>;

export function usdRates(env?: { FX_USD_IDR?: string }): FxRates {
	const idr = Number(env?.FX_USD_IDR);
	return { ...STATIC_USD_RATES, IDR: Number.isFinite(idr) && idr > 0 ? idr : DEFAULT_USD_IDR };
}

const CURRENCY_RE = /^[A-Za-z]{3}$/;

/** Uppercased ISO-4217-shaped code, or null for anything else. */
export function normalizeCurrency(raw: unknown): string | null {
	return typeof raw === "string" && CURRENCY_RE.test(raw.trim()) ? raw.trim().toUpperCase() : null;
}

/** Unknown or missing source currencies are treated as USD. */
export function convertAmount(
	amount: number,
	from: string | null,
	to: string,
	rates: FxRates,
): number {
	const fromRate = rates[(from ?? "USD").toUpperCase()] ?? 1;
	const toRate = rates[to] ?? 1;
	return (amount * toRate) / fromRate;
}

export interface MoneyContext {
	currency: string;
	rates: FxRates;
}

export const USD_MONEY: MoneyContext = { currency: "USD", rates: usdRates() };

/**
 * SQL factor that converts a row's revenue into ctx.currency, keyed on the
 * row's currency column (NULL/empty/unknown = USD).
 */
export function fxFactorSql(ctx: MoneyContext, currencyColumn = "currency"): RawBuilder<number> {
	const toRate = ctx.rates[ctx.currency] ?? 1;
	const branches = Object.entries(ctx.rates)
		.filter(([code]) => code !== "USD")
		.map(([code, rate]) => sql`WHEN ${code} THEN ${toRate / rate}`);
	return sql<number>`(CASE UPPER(COALESCE(NULLIF(${sql.ref(currencyColumn)}, ''), 'USD')) ${sql.join(branches, sql` `)} ELSE ${toRate} END)`;
}

/** `revenue` converted into ctx.currency, ready to SUM. */
export function revenueSql(
	ctx: MoneyContext,
	revenueColumn = "revenue",
	currencyColumn = "currency",
): RawBuilder<number> {
	return sql<number>`(${sql.ref(revenueColumn)} * ${fxFactorSql(ctx, currencyColumn)})`;
}
