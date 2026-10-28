/**
 * Cross-product earnings: GET /api/portfolio/revenue (session auth).
 * Response shape mirrors `PortfolioRevenue` in the Worker (lib/portfolio.ts).
 * Amounts are already converted into `currency`; days are UTC.
 */
import { legacyFetch } from "./api";

export interface EarningsTotals {
	gross: number;
	net: number;
	sales: number;
	refunds: number;
	refund_amount: number;
}

export interface EarningsRecent {
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
}

export interface Earnings {
	currency: string;
	from: string;
	to: string;
	totals: EarningsTotals;
	by_site: { site_id: string; site_name: string; gross: number; net: number; sales: number }[];
	by_product: {
		product: string | null;
		site_id: string;
		site_name: string;
		gross: number;
		net: number;
		sales: number;
	}[];
	by_rail: { rail: string; gross: number; net: number; sales: number }[];
	daily: { date: string; gross: number; net: number; sales: number }[];
	recent: EarningsRecent[];
}

export type EarningsPreset = "today" | "7d" | "month" | "30d";

export const EARNINGS_PRESETS: readonly { key: EarningsPreset; label: string }[] = [
	{ key: "today", label: "Today" },
	{ key: "7d", label: "7d" },
	{ key: "month", label: "This month" },
	{ key: "30d", label: "30d" },
];

/** `undefined` = let the server pick the user's most common site currency. */
export const EARNINGS_CURRENCIES: readonly { code: string | undefined; label: string }[] = [
	{ code: undefined, label: "Auto" },
	{ code: "IDR", label: "IDR" },
	{ code: "USD", label: "USD" },
	{ code: "EUR", label: "EUR" },
	{ code: "SGD", label: "SGD" },
	{ code: "MYR", label: "MYR" },
	{ code: "GBP", label: "GBP" },
	{ code: "JPY", label: "JPY" },
	{ code: "AUD", label: "AUD" },
];

const MS_PER_DAY = 86_400_000;
const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Inclusive UTC day range for a preset, matching the server's UTC day buckets. */
export const presetRange = (
	preset: EarningsPreset,
	nowMs = Date.now(),
): { from: string; to: string } => {
	const to = isoDay(nowMs);
	switch (preset) {
		case "today": {
			return { from: to, to };
		}
		case "7d": {
			return { from: isoDay(nowMs - 6 * MS_PER_DAY), to };
		}
		case "month": {
			return { from: `${to.slice(0, 7)}-01`, to };
		}
		case "30d": {
			return { from: isoDay(nowMs - 29 * MS_PER_DAY), to };
		}
		default: {
			return { from: to, to };
		}
	}
};

/** Every UTC day in [from, to], zero-filled where the server returned no row. */
export const fillDaily = (
	daily: Earnings["daily"],
	from: string,
	to: string,
): Earnings["daily"] => {
	const byDate = new Map(daily.map((d) => [d.date, d]));
	const out: Earnings["daily"] = [];
	const end = Date.parse(`${to}T00:00:00Z`);
	for (let t = Date.parse(`${from}T00:00:00Z`); t <= end; t += MS_PER_DAY) {
		const date = isoDay(t);
		out.push(byDate.get(date) ?? { date, gross: 0, net: 0, sales: 0 });
	}
	return out;
};

export const fetchEarnings = (
	from: string,
	to: string,
	currency: string | undefined,
): Promise<Earnings> => {
	const p = new URLSearchParams({ from, to });
	if (currency) {
		p.set("currency", currency);
	}
	return legacyFetch(`/portfolio/revenue?${p}`);
};

export const formatMoney = (amount: number, currency: string): string => {
	try {
		return new Intl.NumberFormat(undefined, { currency, style: "currency" }).format(amount);
	} catch {
		return `${currency} ${amount.toFixed(2)}`;
	}
};

const RAIL_LABELS: Record<string, string> = {
	apple: "App Store",
	doku: "DOKU",
	google_play: "Google Play",
	lemonsqueezy: "Lemon Squeezy",
	manual: "Manual",
	mayar: "Mayar",
	midtrans: "Midtrans",
	pakasir: "Pakasir (QRIS)",
	paywuz: "Paywuz",
	polar: "Polar",
	stripe: "Stripe",
	xendit: "Xendit",
};

export const railLabel = (rail: string): string => RAIL_LABELS[rail] ?? rail;
