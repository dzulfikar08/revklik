import { sql, type Kysely, type RawBuilder } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";

/**
 * Fallback FX table, units of each currency per 1 USD. Approximate on purpose:
 * it only has to make mixed-currency totals comparable, not settle money, and
 * it is what converts until the daily refresh (refreshFxRates) has stored real
 * rates. It covers every currency the App Store prices in, so an unknown code
 * no longer passes through as if it were dollars. IDR follows env FX_USD_IDR so
 * the dominant non-USD currency can be tuned without a deploy of new code.
 */
const STATIC_USD_RATES: Record<string, number> = {
	USD: 1,
	EUR: 0.92,
	SGD: 1.35,
	MYR: 4.7,
	JPY: 150,
	GBP: 0.78,
	AUD: 1.5,
	CAD: 1.37,
	NZD: 1.65,
	CHF: 0.88,
	SEK: 10.5,
	NOK: 10.8,
	DKK: 6.9,
	PLN: 4,
	CZK: 23,
	HUF: 360,
	RON: 4.6,
	BGN: 1.8,
	TRY: 34,
	MXN: 18,
	BRL: 5.5,
	CLP: 950,
	COP: 4200,
	PEN: 3.75,
	THB: 35,
	PHP: 57,
	VND: 25_000,
	KRW: 1350,
	CNY: 7.2,
	HKD: 7.8,
	TWD: 32,
	INR: 84,
	PKR: 280,
	ILS: 3.7,
	AED: 3.67,
	SAR: 3.75,
	QAR: 3.64,
	EGP: 49,
	ZAR: 18,
	NGN: 1600,
	KZT: 480,
	UAH: 41,
};

export const DEFAULT_USD_IDR = 16_000;

export type FxRates = Readonly<Record<string, number>>;

export function usdRates(env?: { FX_USD_IDR?: string }): FxRates {
	const idr = Number(env?.FX_USD_IDR);
	return { ...STATIC_USD_RATES, IDR: Number.isFinite(idr) && idr > 0 ? idr : DEFAULT_USD_IDR };
}

/** Public ECB-based feed: `{ date, rates: { JPY: 150.1, ... } }` for base USD. */
const FX_FEED_URL = "https://api.frankfurter.dev/v1/latest?base=USD";
const FX_CACHE_MS = 60 * 60_000;

let storedRates: { rates: Record<string, number>; loadedAt: number } | null = null;

/**
 * Today's rates: the fallback table overlaid with whatever the daily refresh
 * stored, cached per isolate for an hour. FX_USD_IDR still wins for IDR. A
 * failing read falls back to the static table; revenue must never 500 over FX.
 */
export async function loadUsdRates(
	db: Kysely<KlikapaDatabase>,
	env?: { FX_USD_IDR?: string },
	nowMs = Date.now(),
): Promise<FxRates> {
	if (!storedRates || nowMs - storedRates.loadedAt > FX_CACHE_MS) {
		try {
			const rows = await db.selectFrom("fx_rates").select(["currency", "per_usd"]).execute();
			storedRates = {
				rates: Object.fromEntries(rows.map((r) => [r.currency.toUpperCase(), r.per_usd])),
				loadedAt: nowMs,
			};
		} catch (err) {
			console.error("[fx] stored rates unavailable, using the fallback table:", err);
			storedRates = { rates: {}, loadedAt: nowMs };
		}
	}
	return { ...usdRates(env), ...storedRates.rates, ...idrOverride(env) };
}

function idrOverride(env?: { FX_USD_IDR?: string }): Record<string, number> {
	const idr = Number(env?.FX_USD_IDR);
	return Number.isFinite(idr) && idr > 0 ? { IDR: idr } : {};
}

/** Test seam: forget the cached stored rates. */
export function clearStoredRatesCache(): void {
	storedRates = null;
}

/**
 * Daily job: pull current rates for base USD and store them. A feed failure
 * keeps yesterday's rates (and the static fallback) in place.
 */
export async function refreshFxRates(
	db: Kysely<KlikapaDatabase>,
	fetchFeed: typeof fetch = fetch,
): Promise<number> {
	const res = await fetchFeed(FX_FEED_URL);
	if (!res.ok) throw new Error(`FX feed answered HTTP ${res.status}`);
	const feed = (await res.json()) as { date?: string; rates?: Record<string, number> };
	const asOf = feed.date ?? new Date().toISOString().slice(0, 10);
	const rows = Object.entries(feed.rates ?? {})
		.filter(([code, rate]) => /^[A-Z]{3}$/.test(code) && Number.isFinite(rate) && rate > 0)
		.map(([currency, per_usd]) => ({ currency, per_usd, as_of: asOf }));
	if (rows.length === 0) throw new Error("FX feed returned no usable rates");
	await db
		.insertInto("fx_rates")
		.values(rows)
		.onConflict((oc) =>
			oc.column("currency").doUpdateSet((eb) => ({
				per_usd: eb.ref("excluded.per_usd"),
				as_of: eb.ref("excluded.as_of"),
			})),
		)
		.execute();
	storedRates = null;
	return rows.length;
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
