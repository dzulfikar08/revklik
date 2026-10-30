/**
 * Client for the klikapa Worker's cross-product revenue endpoints:
 * GET /portfolio/revenue and GET/PUT /fee-rules.
 */
import { legacyFetch } from "./api";

export interface PortfolioTotals {
	gross: number;
	net: number;
	sales: number;
	refunds: number;
	refund_amount: number;
	/** Rows with no stored net whose net was computed by fee rule at read time. */
	estimated_rows: number;
}

export interface PortfolioRevenue {
	currency: string;
	from: string;
	to: string;
	totals: PortfolioTotals;
	by_site: { site_id: string; site_name: string; gross: number; net: number; sales: number }[];
	by_product: {
		product: string | null;
		site_id: string;
		site_name: string;
		gross: number;
		net: number;
		sales: number;
	}[];
	by_rail: { rail: string; gross: number; net: number; sales: number; estimated_rows: number }[];
	daily: { date: string; gross: number; net: number; sales: number }[];
	recent: {
		event_id: string;
		site_id: string;
		site_name: string;
		product: string | null;
		rail: string;
		name: string | null;
		revenue: number;
		net_revenue: number;
		/** "reported" | "rule" | "refund_ratio" | "estimated" (no stored net, rule applied at read time). */
		net_source: string;
		currency: string;
		converted_gross: number;
		converted_net: number;
		occurred_at: string;
	}[];
}

export interface FeeRule {
	rail: string;
	percent_bps: number;
	fixed_amount: number;
	fixed_currency: string | null;
	/** True while the built-in default applies (no saved override). */
	is_default: boolean;
}

export type FeeRuleInput =
	| { rail: string; percent_bps: number; fixed_amount: number; fixed_currency: string | null }
	| { rail: string; reset: true };

/** `currency` converts every figure; omitted, the API picks the owner's most common site currency. */
export const fetchPortfolio = (
	from: string,
	to: string,
	currency?: string,
): Promise<PortfolioRevenue> => {
	const p = new URLSearchParams({ from, to });
	if (currency) {
		p.set("currency", currency);
	}
	return legacyFetch(`/portfolio/revenue?${p}`);
};

export const fetchFeeRules = (): Promise<FeeRule[]> => legacyFetch("/fee-rules");

export const saveFeeRules = (rules: FeeRuleInput[]): Promise<FeeRule[]> =>
	legacyFetch("/fee-rules", { body: JSON.stringify({ rules }), method: "PUT" });
