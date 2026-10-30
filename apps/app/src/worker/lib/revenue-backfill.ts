import {
	canonicalRail,
	defaultFeeRule,
	netAfterRule,
	netByRefundRatio,
	resolveProduct,
	type FeeRule,
	type NetSource,
} from "./fees";
import { normalizeCurrency, type FxRates } from "./fx";
import {
	CLIENT_DOUBLE_FIRE_MS,
	CLIENT_ORDER_MATCH_MS,
	syntheticVisitorId,
	testEventReason,
	type ExcludedReason,
} from "./revenue-hygiene";

/** One stored revenue row as the backfill reads it, joined to its site's owner. */
export interface BackfillEvent {
	id: string;
	site_id: string;
	owner_id: string | null;
	visitor_id: string;
	timestamp: string;
	event_type: string;
	path: string;
	revenue: number;
	currency: string | null;
	rail: string | null;
	product: string | null;
	payment_provider: string | null;
	net_revenue: number | null;
	net_source: string | null;
	external_id: string | null;
	props: string | null;
	excluded_reason: string | null;
}

/** Column changes for one event; absent fields stay as stored. */
export interface EventPatch {
	id: string;
	visitor_id: string;
	site_id: string;
	revenue: number;
	rail?: string;
	product?: string;
	payment_provider?: string;
	net?: { net_revenue: number; net_source: NetSource };
	excluded_reason?: ExcludedReason;
}

export interface BackfillContext {
	rates: FxRates;
	/** Saved fee rules keyed `${owner_id}\u0000${rail}`; defaults apply otherwise. */
	rules: ReadonlyMap<string, FeeRule>;
}

export interface BackfillPlan {
	patches: EventPatch[];
	counts: {
		rail: number;
		product: number;
		net: number;
		test: number;
		duplicate: number;
	};
}

const REFUND_SUFFIX = ":refund";

function parseProps(raw: string | null): Record<string, unknown> {
	if (!raw) return {};
	try {
		const value: unknown = JSON.parse(raw);
		return value && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

const currencyOf = (e: BackfillEvent): string => normalizeCurrency(e.currency) ?? "USD";
const timeOf = (e: BackfillEvent): number => Date.parse(e.timestamp);

/** Rail a row should store: its own, else the one its legacy provider or props.source implies. */
function railFor(e: BackfillEvent, props: Record<string, unknown>): string | null {
	const own = e.rail?.trim();
	if (own) return own;
	const provider =
		e.payment_provider?.trim() || (typeof props.source === "string" ? props.source : "");
	const rail = canonicalRail(null, provider);
	return rail === "other" ? null : rail;
}

/** Ids of browser-reported rows (no external_id) that repeat or pre-announce another row. */
function findDuplicates(events: BackfillEvent[], props: Map<string, Record<string, unknown>>) {
	const duplicates = new Set<string>();
	const clientRows = events.filter(
		(e) =>
			e.external_id === null &&
			e.event_type === "conversion" &&
			e.revenue > 0 &&
			e.excluded_reason === null &&
			testEventReason({
				rail: e.rail,
				provider: e.payment_provider,
				props: props.get(e.id) ?? {},
			}) === null,
	);

	// Same visitor, page and amount within a minute: a reloaded thank-you page.
	const lastKept = new Map<string, number>();
	for (const e of [...clientRows].sort((a, b) => timeOf(a) - timeOf(b))) {
		const key = [e.site_id, e.visitor_id, e.path, e.revenue, currencyOf(e)].join("\u0000");
		const previous = lastKept.get(key);
		if (previous !== undefined && timeOf(e) - previous <= CLIENT_DOUBLE_FIRE_MS) {
			duplicates.add(e.id);
			continue;
		}
		lastKept.set(key, timeOf(e));
	}

	// A confirmed order (has an external id) and a browser row for the same sale: keep the order.
	// A test or already-excluded order never claims a real browser sale.
	const orders = events.filter(
		(e) =>
			e.external_id !== null &&
			!e.external_id.endsWith(REFUND_SUFFIX) &&
			e.revenue > 0 &&
			e.excluded_reason === null &&
			testEventReason({
				rail: e.rail,
				provider: e.payment_provider,
				props: props.get(e.id) ?? {},
			}) === null,
	);
	const claimed = new Set<string>();
	for (const order of orders) {
		const orderProps = props.get(order.id) ?? {};
		const orderRail = railFor(order, orderProps);
		if (!orderRail) continue;
		let best: BackfillEvent | null = null;
		let bestGap = Number.POSITIVE_INFINITY;
		for (const client of clientRows) {
			if (duplicates.has(client.id) || claimed.has(client.id)) continue;
			if (client.site_id !== order.site_id || client.revenue !== order.revenue) continue;
			// An order that names its buyer only claims that buyer's browser row.
			const orderProvider =
				order.payment_provider ?? (typeof orderProps.source === "string" ? orderProps.source : "");
			const orderSynthetic =
				order.visitor_id === syntheticVisitorId(orderProvider, order.external_id ?? "");
			if (!orderSynthetic && order.visitor_id !== client.visitor_id) continue;
			if (currencyOf(client) !== currencyOf(order)) continue;
			if (railFor(client, props.get(client.id) ?? {}) !== orderRail) continue;
			const gap = Math.abs(timeOf(client) - timeOf(order));
			if (gap > CLIENT_ORDER_MATCH_MS || gap >= bestGap) continue;
			best = client;
			bestGap = gap;
		}
		if (best) {
			claimed.add(best.id);
			duplicates.add(best.id);
		}
	}
	return duplicates;
}

/**
 * The column changes that make stored revenue rows canonical: rail and product
 * where missing, the net where missing (fee rule, or the sale's ratio for a
 * refund), and the exclusion of test sales and double-booked sales. Pure and
 * idempotent: a row already in its target state yields no patch.
 */
export function planRevenueBackfill(events: BackfillEvent[], ctx: BackfillContext): BackfillPlan {
	const props = new Map(events.map((e) => [e.id, parseProps(e.props)]));
	const duplicates = findDuplicates(events, props);
	const patches = new Map<string, EventPatch>();
	const counts = { rail: 0, product: 0, net: 0, test: 0, duplicate: 0 };
	const patchOf = (e: BackfillEvent): EventPatch => {
		let patch = patches.get(e.id);
		if (!patch) {
			patch = { id: e.id, visitor_id: e.visitor_id, site_id: e.site_id, revenue: e.revenue };
			patches.set(e.id, patch);
		}
		return patch;
	};

	const state = new Map<string, { rail: string | null; net: number | null; excluded: boolean }>();
	for (const e of events) {
		const p = props.get(e.id) ?? {};
		let excluded = e.excluded_reason !== null;
		if (!excluded) {
			const reason: ExcludedReason | null =
				testEventReason({ rail: e.rail, provider: e.payment_provider, props: p }) ??
				(duplicates.has(e.id) ? "duplicate" : null);
			if (reason) {
				patchOf(e).excluded_reason = reason;
				counts[reason]++;
				excluded = true;
			}
		}

		const rail = railFor(e, p);
		if (!e.rail?.trim() && rail) {
			patchOf(e).rail = rail;
			counts.rail++;
		}
		if (!e.payment_provider && typeof p.source === "string" && p.source.trim()) {
			patchOf(e).payment_provider = p.source.trim();
		}
		if (!e.product) {
			const product = resolveProduct(null, p);
			if (product) {
				patchOf(e).product = product;
				counts.product++;
			}
		}
		state.set(e.id, { rail, net: e.net_revenue, excluded });
	}

	// Sales first, so a refund finds its sale's final net.
	const byExternal = new Map(events.filter((e) => e.external_id).map((e) => [e.external_id, e]));
	const pending = events
		.filter((e) => e.net_revenue === null && e.revenue !== 0 && !state.get(e.id)?.excluded)
		.sort((a, b) => Number(a.revenue < 0) - Number(b.revenue < 0));
	for (const e of pending) {
		const rail = state.get(e.id)?.rail ?? "other";
		const cur = currencyOf(e);
		let net: { net_revenue: number; net_source: NetSource } | null = null;
		if (e.external_id?.endsWith(REFUND_SUFFIX)) {
			const sale = byExternal.get(e.external_id.slice(0, -REFUND_SUFFIX.length));
			const saleNet = sale ? (patches.get(sale.id)?.net?.net_revenue ?? sale.net_revenue) : null;
			const ratio = netByRefundRatio(
				e.revenue,
				sale ? { revenue: sale.revenue, net_revenue: saleNet } : undefined,
			);
			if (ratio !== null) net = { net_revenue: ratio, net_source: "refund_ratio" };
		}
		if (!net) {
			const rule = ctx.rules.get(`${e.owner_id}\u0000${rail}`) ?? defaultFeeRule(rail);
			net = { net_revenue: netAfterRule(e.revenue, cur, rule, ctx.rates), net_source: "rule" };
		}
		patchOf(e).net = net;
		counts.net++;
	}
	return { patches: [...patches.values()], counts };
}

const quote = (value: string): string => `'${value.replaceAll("'", "''")}'`;

/**
 * SQL for one patch, each statement guarded by the column's old state so replaying
 * the file changes nothing. Exclusion first lowers the visitor's lifetime revenue
 * (only while the row still counts), then flags the row.
 */
export function patchSql(patch: EventPatch): string[] {
	const id = quote(patch.id);
	const out: string[] = [];
	if (patch.rail) {
		out.push(
			`UPDATE events SET rail = ${quote(patch.rail)} WHERE id = ${id} AND (rail IS NULL OR rail = '')`,
		);
	}
	if (patch.payment_provider) {
		out.push(
			`UPDATE events SET payment_provider = ${quote(patch.payment_provider)} WHERE id = ${id} AND payment_provider IS NULL`,
		);
	}
	if (patch.product) {
		out.push(
			`UPDATE events SET product = ${quote(patch.product)} WHERE id = ${id} AND product IS NULL`,
		);
	}
	if (patch.net) {
		out.push(
			`UPDATE events SET net_revenue = ${patch.net.net_revenue}, net_source = ${quote(patch.net.net_source)} WHERE id = ${id} AND net_revenue IS NULL`,
		);
	}
	if (patch.excluded_reason) {
		if (patch.revenue > 0) {
			out.push(
				`UPDATE visitor_profiles SET total_revenue = MAX(0, COALESCE(total_revenue, 0) - ${patch.revenue}) WHERE site_id = ${quote(patch.site_id)} AND visitor_id = ${quote(patch.visitor_id)} AND EXISTS (SELECT 1 FROM events WHERE id = ${id} AND excluded_reason IS NULL)`,
			);
		}
		out.push(
			`UPDATE events SET excluded_reason = ${quote(patch.excluded_reason)} WHERE id = ${id} AND excluded_reason IS NULL`,
		);
	}
	return out;
}

export interface RailTotals {
	rail: string;
	sales: number;
	gross: number;
	net: number;
}

/**
 * Per-rail gross and net in `currency` for the rows that count, the way the
 * portfolio reads them. `legacy` reproduces the old behaviour (raw rail or
 * provider, missing net = gross, test and duplicate rows included); otherwise
 * the plan's patches are applied first.
 */
export function totalsByRail(
	events: BackfillEvent[],
	ctx: BackfillContext,
	currency: string,
	mode: "legacy" | "backfilled",
): RailTotals[] {
	const patches =
		mode === "backfilled"
			? new Map(planRevenueBackfill(events, ctx).patches.map((p) => [p.id, p]))
			: new Map<string, EventPatch>();
	const toRate = ctx.rates[currency] ?? 1;
	const acc = new Map<string, RailTotals>();
	for (const e of events) {
		const patch = patches.get(e.id);
		if (mode === "backfilled" && (e.excluded_reason !== null || patch?.excluded_reason)) continue;
		const rail =
			mode === "legacy"
				? e.rail?.trim() || e.payment_provider?.trim() || "other"
				: canonicalRail(patch?.rail ?? e.rail, patch?.payment_provider ?? e.payment_provider);
		const cur = currencyOf(e);
		const rate = ctx.rates[cur];
		const factor = cur === "USD" || rate === undefined ? toRate : toRate / rate;
		const net =
			mode === "legacy"
				? (e.net_revenue ?? e.revenue)
				: (e.net_revenue ?? patch?.net?.net_revenue ?? e.revenue);
		const row = acc.get(rail) ?? { rail, sales: 0, gross: 0, net: 0 };
		row.gross += e.revenue * factor;
		row.net += net * factor;
		if (e.revenue > 0) row.sales++;
		acc.set(rail, row);
	}
	return [...acc.values()].sort((a, b) => b.gross - a.gross);
}
