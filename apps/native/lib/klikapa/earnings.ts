/**
 * Cross-product earnings: GET /api/portfolio/revenue (session auth).
 * Response shape mirrors `PortfolioRevenue` in the Worker (lib/portfolio.ts).
 * Amounts are already converted into `currency`; days are cut at the device's
 * local midnight (`tz`, east-positive minutes), like the web dashboard.
 */
import { numberLocale, t } from "../i18n";
import { legacyFetch } from "./api";
import { deviceTzOffset } from "../earnings-range";
import type { EarningsDaily, EarningsPreset } from "../earnings-range";

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
	daily: EarningsDaily[];
	recent: EarningsRecent[];
}

export const EARNINGS_PRESETS: readonly { key: EarningsPreset; label: string }[] = [
	{ key: "today", label: t("earn.today") },
	{ key: "7d", label: "7d" },
	{ key: "month", label: t("earn.month") },
	{ key: "30d", label: "30d" },
];

/** `undefined` = let the server pick the user's most common site currency. */
export const EARNINGS_CURRENCIES: readonly { code: string | undefined; label: string }[] = [
	{ code: undefined, label: t("earn.auto") },
	{ code: "IDR", label: "IDR" },
	{ code: "USD", label: "USD" },
	{ code: "EUR", label: "EUR" },
	{ code: "SGD", label: "SGD" },
	{ code: "MYR", label: "MYR" },
	{ code: "GBP", label: "GBP" },
	{ code: "JPY", label: "JPY" },
	{ code: "AUD", label: "AUD" },
];

export const fetchEarnings = (
	from: string,
	to: string,
	currency: string | undefined,
): Promise<Earnings> => {
	const p = new URLSearchParams({ from, to, tz: String(deviceTzOffset()) });
	if (currency) {
		p.set("currency", currency);
	}
	return legacyFetch(`/portfolio/revenue?${p}`);
};

/** Whole-currency amount in the active language's number format (IDR always id-ID, like the web). */
export const formatMoney = (amount: number, currency: string): string => {
	try {
		return new Intl.NumberFormat(currency === "IDR" ? "id-ID" : numberLocale, {
			currency,
			style: "currency",
			...(currency === "IDR" || currency === "JPY"
				? { maximumFractionDigits: 0, minimumFractionDigits: 0 }
				: {}),
		}).format(amount);
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
