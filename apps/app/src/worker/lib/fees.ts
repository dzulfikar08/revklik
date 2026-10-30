import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { convertAmount, loadUsdRates, normalizeCurrency } from "./fx";

/** Payment fee of one rail: `percent_bps`/10000 of the amount plus a fixed charge. */
export interface FeeRule {
	rail: string;
	percent_bps: number;
	fixed_amount: number;
	/** Currency of fixed_amount; USD when null. */
	fixed_currency: string | null;
}

export type NetSource = "reported" | "rule" | "refund_ratio";

/** Built-in fees used until the owner saves a rule for the rail. */
export const DEFAULT_FEE_RULES: Readonly<Record<string, FeeRule>> = {
	apple: { rail: "apple", percent_bps: 1500, fixed_amount: 0, fixed_currency: null },
	google_play: { rail: "google_play", percent_bps: 1500, fixed_amount: 0, fixed_currency: null },
	polar: { rail: "polar", percent_bps: 400, fixed_amount: 0.4, fixed_currency: "USD" },
	stripe: { rail: "stripe", percent_bps: 290, fixed_amount: 0.3, fixed_currency: "USD" },
	doku: { rail: "doku", percent_bps: 70, fixed_amount: 0, fixed_currency: null },
	pakasir: { rail: "pakasir", percent_bps: 70, fixed_amount: 0, fixed_currency: null },
};

const NO_FEE: Omit<FeeRule, "rail"> = { percent_bps: 0, fixed_amount: 0, fixed_currency: null };

export const MAX_RAIL_LENGTH = 40;
const RAIL_RE = /^[a-z0-9][a-z0-9_.-]*$/;
/** Value used to round money so float noise never reaches storage (1e-6 of a unit). */
const MONEY_PRECISION = 1e6;
/** Slack when comparing |net| with |revenue| (float representation). */
const NET_EPSILON = 1e-9;
const REFUND_SUFFIX = ":refund";

/** Source-name prefixes mapped to a canonical rail, first match wins. */
const SOURCE_RAIL_PREFIXES: ReadonlyArray<readonly [string, string]> = [
	["app_store", "apple"],
	["appstore", "apple"],
	["apple", "apple"],
	["google", "google_play"],
	["play", "google_play"],
	["polar", "polar"],
	["doku", "doku"],
	["pakasir", "pakasir"],
	["stripe", "stripe"],
	["lemonsqueezy", "lemonsqueezy"],
	["lemon_squeezy", "lemonsqueezy"],
	["midtrans", "midtrans"],
	["xendit", "xendit"],
	["mayar", "mayar"],
	["paywuz", "paywuz"],
	["manual", "manual"],
];

/** Lowercase rail slug, or null when the value is not a usable rail. */
export function normalizeRail(raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	const rail = raw.trim().toLowerCase();
	return rail.length > 0 && rail.length <= MAX_RAIL_LENGTH && RAIL_RE.test(rail) ? rail : null;
}

/** Rail implied by the reporting source when the caller sent none. */
export function railFromSource(source: string): string {
	const lower = source.trim().toLowerCase();
	for (const [prefix, rail] of SOURCE_RAIL_PREFIXES) {
		if (lower.startsWith(prefix)) return rail;
	}
	return normalizeRail(lower) ?? lower.slice(0, MAX_RAIL_LENGTH);
}

/**
 * Rail of a stored row: its own rail, else the rail its legacy payment_provider
 * implies, else "other". Never maps an explicit rail through the source prefixes
 * (a custom "playground" rail must not become google_play).
 */
export function canonicalRail(
	rail: string | null | undefined,
	provider: string | null | undefined,
): string {
	const own = rail?.trim();
	if (own) return own;
	const legacy = provider?.trim();
	return legacy ? railFromSource(legacy) : "other";
}

/** Product slug: explicit, else props.product, else props.app. Null when none is a string. */
export function resolveProduct(
	explicit: string | null | undefined,
	props: Record<string, unknown> | undefined,
	maxLength = 80,
): string | null {
	for (const candidate of [explicit, props?.product, props?.app]) {
		if (typeof candidate === "string" && candidate.trim()) {
			return candidate.trim().slice(0, maxLength);
		}
	}
	return null;
}

export function defaultFeeRule(rail: string): FeeRule {
	return DEFAULT_FEE_RULES[rail] ?? { rail, ...NO_FEE };
}

const round = (n: number): number => Math.round(n * MONEY_PRECISION) / MONEY_PRECISION;

/** Net the merchant keeps from `revenue` (signed) after `rule`, in the revenue's currency. */
export function netAfterRule(
	revenue: number,
	currency: string,
	rule: FeeRule,
	rates: Readonly<Record<string, number>>,
): number {
	if (revenue === 0) return 0;
	const gross = Math.abs(revenue);
	const fixed =
		rule.fixed_amount > 0
			? convertAmount(
					rule.fixed_amount,
					rule.fixed_currency ?? "USD",
					currency.toUpperCase(),
					rates,
				)
			: 0;
	const fee = (gross * rule.percent_bps) / 10_000 + fixed;
	return Math.sign(revenue) * round(Math.max(0, gross - fee));
}

/** A refund keeps the sale's net/gross ratio; null when the sale gives no usable ratio. */
export function netByRefundRatio(
	revenue: number,
	sale: { revenue: number | null; net_revenue: number | null } | undefined,
): number | null {
	if (!sale || sale.net_revenue === null || !sale.revenue) return null;
	const ratio = Math.min(1, Math.max(0, sale.net_revenue / sale.revenue));
	return round(revenue * ratio);
}

/** True when a reported net has the revenue's sign and does not exceed it. */
export function isValidReportedNet(revenue: number, net: number): boolean {
	if (!Number.isFinite(net)) return false;
	if (revenue === 0) return net === 0;
	return (
		Math.sign(net) * Math.sign(revenue) >= 0 && Math.abs(net) <= Math.abs(revenue) + NET_EPSILON
	);
}

/** The owner's saved rules over the built-in defaults, one entry per rail. */
export async function loadEffectiveFeeRules(
	db: Kysely<KlikapaDatabase>,
	userId: string,
): Promise<{ rules: FeeRule[]; custom: string[] }> {
	const rows = await db
		.selectFrom("fee_rules")
		.select(["rail", "percent_bps", "fixed_amount", "fixed_currency"])
		.where("user_id", "=", userId)
		.execute();
	const merged = new Map<string, FeeRule>(Object.entries(DEFAULT_FEE_RULES));
	for (const row of rows) merged.set(row.rail, row);
	return {
		rules: [...merged.values()].sort((a, b) => a.rail.localeCompare(b.rail)),
		custom: rows.map((r) => r.rail),
	};
}

export interface NetInput {
	siteId: string;
	rail: string;
	revenue: number;
	currency: string;
	externalId?: string | null;
	/** Real proceeds from the source; already validated against `revenue`. */
	reportedNet?: number | null;
	env?: { FX_USD_IDR?: string };
}

export interface NetFields {
	net_revenue: number | null;
	net_source: NetSource | null;
}

/**
 * Net for one event as stored at ingest: reported proceeds, else the refund
 * ratio of the original sale, else the owner's fee rule for the rail.
 */
export async function resolveNet(db: Kysely<KlikapaDatabase>, input: NetInput): Promise<NetFields> {
	if (input.revenue === 0) return { net_revenue: null, net_source: null };
	if (input.reportedNet !== null && input.reportedNet !== undefined) {
		return { net_revenue: input.reportedNet, net_source: "reported" };
	}

	if (input.externalId?.endsWith(REFUND_SUFFIX)) {
		const sale = await db
			.selectFrom("events")
			.select(["revenue", "net_revenue"])
			.where("site_id", "=", input.siteId)
			.where("external_id", "=", input.externalId.slice(0, -REFUND_SUFFIX.length))
			// Naming is_bot opts out of the events plugin, so a test sale's refund still finds it.
			.where("is_bot", "in", [0, 1])
			.executeTakeFirst();
		const net = netByRefundRatio(input.revenue, sale);
		if (net !== null) return { net_revenue: net, net_source: "refund_ratio" };
	}

	const site = await db
		.selectFrom("sites")
		.select(["user_id"])
		.where("id", "=", input.siteId)
		.executeTakeFirst();
	let rule = defaultFeeRule(input.rail);
	if (site) {
		const saved = await db
			.selectFrom("fee_rules")
			.select(["rail", "percent_bps", "fixed_amount", "fixed_currency"])
			.where("user_id", "=", site.user_id)
			.where("rail", "=", input.rail)
			.executeTakeFirst();
		if (saved) rule = saved;
	}
	const rates = rule.fixed_amount > 0 ? await loadUsdRates(db, input.env) : {};
	const currency = normalizeCurrency(input.currency) ?? "USD";
	return {
		net_revenue: netAfterRule(input.revenue, currency, rule, rates),
		net_source: "rule",
	};
}

/** Columns a provider webhook adds to its events insert: rail and the computed net. */
export async function webhookRevenueFields(
	db: Kysely<KlikapaDatabase>,
	input: Omit<NetInput, "reportedNet">,
): Promise<NetFields & { rail: string }> {
	return { rail: input.rail, ...(await resolveNet(db, input)) };
}
