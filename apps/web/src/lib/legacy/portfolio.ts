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
	by_rail: { rail: string; gross: number; net: number; sales: number }[];
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

export const fetchPortfolio = (from: string, to: string): Promise<PortfolioRevenue> =>
	legacyFetch(`/portfolio/revenue?from=${from}&to=${to}`);

export const fetchFeeRules = (): Promise<FeeRule[]> => legacyFetch("/fee-rules");

export const saveFeeRules = (rules: FeeRuleInput[]): Promise<FeeRule[]> =>
	legacyFetch("/fee-rules", { body: JSON.stringify({ rules }), method: "PUT" });
