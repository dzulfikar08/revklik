import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { sql } from "../db";
import { normalizeRail, railFromSource, resolveNet, resolveProduct, type NetFields } from "./fees";

/** Why a stored event is left out of every read; NULL on the column means counted. */
export type ExcludedReason = "test" | "duplicate" | "unconfirmed";

/** Sources, rails and providers that mark synthetic sales (tracking_smoketest, test_checkout, ...). */
const TEST_SOURCE_RE = /(^|[_.-])(smoke)?test(s|ing)?($|[_.-])|smoketest/i;

/** A conversion reported by the same visitor with the same amount on the same page within this window is a double fire. */
export const CLIENT_DOUBLE_FIRE_MS = 60_000;

/**
 * A browser-reported conversion and the order that confirms it land this close
 * together (observed: 10-20 s). The match is by time, not amount: the browser
 * reports the list price, the order what was actually paid.
 */
export const CLIENT_ORDER_MATCH_MS = 10 * 60_000;

function isTestLabel(value: unknown): boolean {
	return typeof value === "string" && TEST_SOURCE_RE.test(value);
}

/**
 * "test" when the sale is synthetic: `props._test` is true, or the rail, the
 * payment provider or `props.source` names a test source.
 */
export function testEventReason(input: {
	rail?: string | null;
	provider?: string | null;
	props?: Record<string, unknown> | null;
}): "test" | null {
	const props = input.props;
	if (props?._test === true || props?._test === "true" || props?._test === 1) return "test";
	if (isTestLabel(input.rail) || isTestLabel(input.provider) || isTestLabel(props?.source)) {
		return "test";
	}
	return null;
}

/** Visitor id given to a server-reported sale that names no buyer. */
export const syntheticVisitorId = (source: string, externalId: string): string =>
	`${source}_${externalId.replace(/[^a-zA-Z0-9]/g, "_")}`.slice(0, 120);

export const isoWindow = (ts: string, ms: number): { from: string; to: string } => {
	const at = Date.parse(ts);
	return { from: new Date(at - ms).toISOString(), to: new Date(at + ms).toISOString() };
};

/**
 * Id of a conversion the same visitor already reported with the same amount on
 * the same page shortly before `ts`: a reloaded thank-you page, not a second sale.
 * Earlier rows already marked duplicate count too, so a third reload still matches.
 */
export async function findClientDoubleFire(
	db: Kysely<KlikapaDatabase>,
	input: {
		siteId: string;
		visitorId: string;
		path: string;
		revenue: number;
		currency: string | null;
		ts: string;
	},
): Promise<string | null> {
	const window = isoWindow(input.ts, CLIENT_DOUBLE_FIRE_MS);
	const row = await db
		.selectFrom("events")
		.select("id")
		.where("site_id", "=", input.siteId)
		.where("visitor_id", "=", input.visitorId)
		// Naming is_bot opts out of the plugin: excluded duplicates must stay visible here.
		.where("is_bot", "=", 0)
		.where(sql<boolean>`(excluded_reason IS NULL OR excluded_reason = 'duplicate')`)
		.where("event_type", "=", "conversion")
		.where("path", "=", input.path)
		.where("revenue", "=", input.revenue)
		.where(sql<boolean>`COALESCE(currency, 'USD') = ${input.currency ?? "USD"}`)
		.where("timestamp", ">=", window.from)
		.where("timestamp", "<=", window.to)
		.limit(1)
		.executeTakeFirst();
	return row?.id ?? null;
}

/**
 * Id of a confirmed order (has an external id) that already books this
 * browser-reported sale: same site, rail and currency within the match window
 * (any amount), and the same buyer, or an order that names no buyer. An order is
 * claimed by one browser row only: a browser row stored as its duplicate carries
 * `props.duplicate_of = <order external id>`, and such an order is taken.
 * Returns the order's external id.
 */
export async function findConfirmedOrder(
	db: Kysely<KlikapaDatabase>,
	input: {
		siteId: string;
		visitorId: string;
		rail: string;
		currency: string;
		ts: string;
	},
): Promise<string | null> {
	const window = isoWindow(input.ts, CLIENT_ORDER_MATCH_MS);
	const { rows } = await sql<{
		id: string;
		visitor_id: string;
		payment_provider: string | null;
		external_id: string;
	}>`SELECT o.id, o.visitor_id, o.payment_provider, o.external_id FROM events o
		WHERE o.site_id = ${input.siteId} AND o.external_id IS NOT NULL AND o.external_id NOT LIKE '%:refund'
		AND o.event_type = 'conversion' AND o.revenue > 0 AND o.rail = ${input.rail}
		AND UPPER(COALESCE(NULLIF(o.currency, ''), 'USD')) = ${input.currency}
		AND o.timestamp >= ${window.from} AND o.timestamp <= ${window.to}
		AND o.is_bot = 0 AND o.excluded_reason IS NULL
		AND NOT EXISTS (
			SELECT 1 FROM events d WHERE d.site_id = o.site_id AND d.external_id IS NULL
			AND d.excluded_reason = 'duplicate' AND d.rail = o.rail
			AND json_extract(d.props, '$.duplicate_of') = o.external_id
		)
		ORDER BY ABS(julianday(o.timestamp) - julianday(${input.ts})) ASC
		LIMIT 10`.execute(db);
	const match = rows.find(
		(o) =>
			o.visitor_id === input.visitorId ||
			o.visitor_id === syntheticVisitorId(o.payment_provider ?? "", o.external_id),
	);
	return match?.external_id ?? null;
}

export interface ClientSaleFields extends NetFields {
	rail: string | null;
	product: string | null;
	payment_provider: string | null;
	excluded_reason: ExcludedReason | null;
	/** External id of the confirmed order this browser row repeats; stored in its props. */
	duplicate_of: string | null;
}

/**
 * Columns a browser-reported conversion (rv > 0) stores besides the raw amount:
 * the rail its `props.source`/`props.rail` names, the net that rail's fee rule
 * gives, the product slug, and the reason it must not count (test sale, the
 * same visitor firing the same conversion again within a minute, or a sale a
 * confirmed order already booked).
 */
export async function clientSaleFields(
	db: Kysely<KlikapaDatabase>,
	input: {
		siteId: string;
		visitorId: string;
		path: string;
		revenue: number;
		currency: string;
		ts: string;
		props: Record<string, unknown> | undefined;
		/** False for callers with their own idempotency key (the payment API): repeats there are real sales. */
		guardDoubleFire: boolean;
		env?: { FX_USD_IDR?: string };
	},
): Promise<ClientSaleFields> {
	const source = typeof input.props?.source === "string" ? input.props.source.trim() : "";
	const rail = normalizeRail(input.props?.rail) ?? (source ? railFromSource(source) : null);
	const product = resolveProduct(null, input.props);
	const provider = source || null;

	let excluded: ExcludedReason | null = testEventReason({ rail, provider, props: input.props });
	let duplicateOf: string | null = null;
	if (!excluded && input.guardDoubleFire) {
		const twin = await findClientDoubleFire(db, input);
		if (twin) excluded = "duplicate";
		// The order may have landed first; it is the sale, the browser row only repeats it.
		if (!excluded && rail) {
			duplicateOf = await findConfirmedOrder(db, { ...input, rail });
			if (duplicateOf) excluded = "duplicate";
		}
	}
	if (!rail) {
		return {
			rail,
			product,
			payment_provider: provider,
			excluded_reason: excluded,
			duplicate_of: duplicateOf,
			net_revenue: null,
			net_source: null,
		};
	}
	const net = await resolveNet(db, {
		siteId: input.siteId,
		rail,
		revenue: input.revenue,
		currency: input.currency,
		env: input.env,
	});
	return {
		rail,
		product,
		payment_provider: provider,
		excluded_reason: excluded,
		duplicate_of: duplicateOf,
		...net,
	};
}
