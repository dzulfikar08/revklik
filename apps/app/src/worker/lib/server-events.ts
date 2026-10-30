import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { sql } from "../db";
import { generateId } from "../utils";
import { normalizeRail, railFromSource, refundedSaleKey, resolveNet, resolveProduct } from "./fees";
import { fxSnapshot, type FxSnapshot } from "./fx";
import { eventCurrency, MAX_REVENUE, resolveEventTimestamp } from "./ingest";
import {
	CLIENT_ORDER_MATCH_MS,
	isoWindow,
	syntheticVisitorId,
	testEventReason,
} from "./revenue-hygiene";

/** One revenue (or revenue-less) event reported by a trusted server. */
export interface ServerEventInput {
	siteId: string;
	name: string;
	/** Major units, signed: a refund is negative. Zero records a non-revenue event. */
	revenue: number;
	currency?: string | null;
	/** Idempotency key; a second event with the same key is dropped. */
	externalId: string;
	/** Who reported it: "app_store", "polar", ... Stored as the payment provider. */
	source: string;
	props?: Record<string, unknown>;
	occurredAt?: string | number | null;
	/** RevKlik visitor id (`_kp_vid`); the sale inherits that visitor's attribution. */
	visitorId?: string | null;
	/** RevKlik session id (`_kp_sid`); wins over visitorId when the session is known. */
	sessionId?: string | null;
	utmSource?: string | null;
	utmMedium?: string | null;
	utmCampaign?: string | null;
	/** Payment rail ("apple", "polar", ...); defaults from `source`. */
	rail?: string | null;
	/** Product slug; defaults from props.product, then props.app. */
	product?: string | null;
	/** Real proceeds in `revenue`'s currency and sign, when the source knows them. */
	netRevenue?: number | null;
	/** Event type; default follows the sign of `revenue` (zero revenue = "custom"). */
	eventType?: "conversion" | "custom" | null;
	/** Page path stored on the event; default `/<source>`. */
	path?: string | null;
	/** The provider says this is a sandbox/test-mode payment: stored, never counted. */
	test?: boolean;
	/** Payment method label stored on the event (`events.payment_method`). */
	paymentMethod?: string | null;
	/** The provider's subscription id, for renewals. */
	subscriptionId?: string | null;
}

export interface ServerEventResult {
	eventId: string;
	visitorId: string;
	duplicate: boolean;
	/** The sale was already counted from the buyer's browser; that row now carries the order id, rail and net. */
	adopted?: boolean;
}

export interface ServerEventSite {
	id: string;
	revenue_currency?: string;
}

/** Event type by sign: sale, refund, or a plain event when no money moved. */
function eventTypeFor(
	revenue: number,
	override?: ServerEventInput["eventType"],
): "conversion" | "refund" | "custom" {
	if (revenue > 0) return "conversion";
	if (revenue < 0) return "refund";
	return override ?? "custom";
}

const COUNTRY_RE = /^[A-Za-z]{2}$/;

interface NetPatch extends FxSnapshot {
	rail: string;
	net_revenue: number | null;
	net_source: "reported" | "rule" | "refund_ratio" | null;
}

/**
 * A thank-you-page conversion (no external_id) that the confirmed sale
 * duplicates: same site, source and currency within the match window, nearest
 * to `ts`, whatever amount the browser reported (it sends the list price). When
 * the order names its buyer only that buyer's row qualifies.
 */
async function findClientConversion(
	db: Kysely<KlikapaDatabase>,
	args: {
		siteId: string;
		source: string;
		rail: string;
		currency: string;
		ts: string;
		/** The buyer the order names; null = unlinked, so the nearest matching row is taken. */
		visitorId: string | null;
	},
): Promise<{
	id: string;
	visitor_id: string;
	props: string | null;
	product: string | null;
	revenue: number;
} | null> {
	const window = isoWindow(args.ts, CLIENT_ORDER_MATCH_MS);
	const { rows } = await sql<{
		id: string;
		visitor_id: string;
		props: string | null;
		product: string | null;
		revenue: number;
	}>`SELECT id, visitor_id, props, product, revenue FROM events
		WHERE site_id = ${args.siteId} AND external_id IS NULL AND event_type = 'conversion'
		AND revenue > 0 AND UPPER(COALESCE(NULLIF(currency, ''), 'USD')) = ${args.currency}
		AND timestamp >= ${window.from} AND timestamp <= ${window.to}
		AND (payment_provider = ${args.source} OR rail = ${args.rail} OR json_extract(props, '$.source') = ${args.source})
		AND is_bot = 0 AND excluded_reason IS NULL
		${args.visitorId === null ? sql`` : sql`AND visitor_id = ${args.visitorId}`}
		ORDER BY ABS(julianday(timestamp) - julianday(${args.ts})) ASC
		LIMIT 2`.execute(db);
	// An order that names no buyer only adopts a row when exactly one browser sale
	// could be it; with two candidates, guessing would swap two buyers' attribution.
	if (args.visitorId === null && rows.length > 1) return null;
	return rows[0] ?? null;
}

/**
 * Store a server-reported event once. Attribution comes from the explicit
 * fields, then from the checkout's session, then from the visitor's latest
 * event; with none of those the event belongs to a synthetic visitor named
 * after the idempotency key.
 */
export async function recordServerEvent(
	db: Kysely<KlikapaDatabase>,
	site: ServerEventSite,
	input: ServerEventInput,
	env?: { FX_USD_IDR?: string },
): Promise<ServerEventResult> {
	if (!Number.isFinite(input.revenue) || Math.abs(input.revenue) > MAX_REVENUE) {
		throw new RangeError("revenue must be a finite number within 1e9");
	}

	// Naming is_bot opts out of the plugin's filters: the idempotency key must see
	// excluded (test) rows too, or its unique index rejects the insert forever.
	const findExisting = () =>
		db
			.selectFrom("events")
			.select(["id", "visitor_id"])
			.where("site_id", "=", site.id)
			.where("external_id", "=", input.externalId)
			.where("is_bot", "in", [0, 1])
			.executeTakeFirst();
	const existing = await findExisting();
	if (existing) {
		// Replaying a sale with its real proceeds (a re-import) upgrades a fee-rule estimate.
		if (input.netRevenue !== null && input.netRevenue !== undefined) {
			await db
				.updateTable("events")
				.set({ net_revenue: input.netRevenue, net_source: "reported" })
				.where("id", "=", existing.id)
				.where(sql<boolean>`COALESCE(net_source, '') != 'reported'`)
				.execute();
		}
		return { eventId: existing.id, visitorId: existing.visitor_id, duplicate: true };
	}

	let visitorId = input.visitorId || null;
	let utmSource = input.utmSource ?? null;
	let utmMedium = input.utmMedium ?? null;
	let utmCampaign = input.utmCampaign ?? null;
	let referrer: string | null = null;
	let country: string | null = null;
	let region: string | null = null;
	let city: string | null = null;
	let sessionId = input.sessionId || null;

	if (sessionId) {
		const session = await db
			.selectFrom("sessions")
			.select(["visitor_id", "utm_source", "utm_medium", "utm_campaign", "referrer"])
			.where("id", "=", sessionId)
			.where("site_id", "=", site.id)
			.executeTakeFirst();
		if (session) {
			visitorId = session.visitor_id;
			utmSource ??= session.utm_source;
			utmMedium ??= session.utm_medium;
			utmCampaign ??= session.utm_campaign;
			referrer = session.referrer;
		}
	}
	// A refund belongs to the visitor who bought: "<id>:refund" follows "<id>".
	const refundedSale = refundedSaleKey(input.externalId);
	if (!visitorId && refundedSale) {
		const sale = await db
			.selectFrom("events")
			.select(["visitor_id", "session_id"])
			.where("site_id", "=", site.id)
			.where("external_id", "=", refundedSale)
			.where("is_bot", "in", [0, 1])
			.executeTakeFirst();
		if (sale) {
			visitorId = sale.visitor_id;
			sessionId ??= sale.session_id;
		}
	}
	// Only a checkout that names its buyer (visitor or session) pins adoption to that buyer.
	const linkedVisitorId = visitorId;
	if (visitorId) {
		// Latest event wins; flagged bot rows never lend attribution to a sale.
		const last = await db
			.selectFrom("events")
			.select(["utm_source", "utm_medium", "utm_campaign", "referrer", "country", "region", "city"])
			.where("site_id", "=", site.id)
			.where("visitor_id", "=", visitorId)
			.where("event_type", "=", "pageview")
			.orderBy("timestamp", "desc")
			.limit(1)
			.executeTakeFirst();
		if (last) {
			utmSource ??= last.utm_source;
			utmMedium ??= last.utm_medium;
			utmCampaign ??= last.utm_campaign;
			referrer ??= last.referrer;
			country = last.country;
			region = last.region;
			city = last.city;
		}
	} else {
		visitorId = syntheticVisitorId(input.source, input.externalId);
	}
	sessionId ??= generateId();

	const propCountry = input.props?.country;
	if (typeof propCountry === "string" && COUNTRY_RE.test(propCountry)) {
		country = propCountry.toUpperCase();
		region = null;
		city = null;
	}

	const ts = resolveEventTimestamp(input.occurredAt, Date.now(), Number.POSITIVE_INFINITY);
	const eventId = generateId();
	const eventType = eventTypeFor(input.revenue, input.eventType);
	const currency = eventCurrency(input.currency, input.props, site.revenue_currency);
	const rail = normalizeRail(input.rail) ?? railFromSource(input.source);
	const net = await resolveNet(db, {
		siteId: site.id,
		rail,
		revenue: input.revenue,
		currency,
		externalId: input.externalId,
		reportedNet: input.netRevenue,
		env,
	});
	const excludedReason = input.test
		? "test"
		: testEventReason({ rail, provider: input.source, props: input.props });
	const fx = await fxSnapshot(db, currency, env);

	// A sale the buyer's browser already reported is one sale: the confirmed order
	// fills in that row instead of booking a second one.
	if (input.revenue > 0 && !excludedReason) {
		const clientRow = await findClientConversion(db, {
			siteId: site.id,
			source: input.source,
			rail,
			currency: currency.toUpperCase(),
			ts,
			visitorId: linkedVisitorId,
		});
		if (clientRow) {
			const adopted = await adoptClientConversion(db, clientRow, input, { rail, ...net, ...fx });
			if (adopted) {
				return {
					eventId: clientRow.id,
					visitorId: clientRow.visitor_id,
					duplicate: false,
					adopted: true,
				};
			}
			const winner = await findExisting();
			if (winner) return { eventId: winner.id, visitorId: winner.visitor_id, duplicate: true };
		}
	}

	try {
		await db
			.insertInto("events")
			.values({
				id: eventId,
				site_id: site.id,
				session_id: sessionId,
				visitor_id: visitorId,
				timestamp: ts,
				event_type: eventType,
				name: input.name,
				path: input.path || `/${input.source}`,
				hostname: null,
				referrer,
				utm_source: utmSource,
				utm_medium: utmMedium,
				utm_campaign: utmCampaign,
				utm_term: null,
				utm_content: null,
				revenue: input.revenue,
				currency,
				rail,
				product: resolveProduct(input.product, input.props),
				net_revenue: net.net_revenue,
				net_source: net.net_source,
				excluded_reason: excludedReason,
				fx_rate: fx.fx_rate,
				fx_date: fx.fx_date,
				fx_status: fx.fx_status,
				payment_provider: input.source,
				payment_method: input.paymentMethod ?? null,
				subscription_id: input.subscriptionId ?? null,
				props: JSON.stringify({
					external_id: input.externalId,
					source: input.source,
					...input.props,
				}),
				country,
				region,
				city,
				device_type: null,
				browser: null,
				os: null,
				fingerprint: null,
				external_id: input.externalId,
			})
			.execute();
	} catch (err) {
		// A concurrent delivery of the same key won the unique index.
		const winner = await findExisting();
		if (winner) return { eventId: winner.id, visitorId: winner.visitor_id, duplicate: true };
		throw err;
	}

	await db
		.insertInto("visitor_profiles")
		.values({
			id: generateId(),
			site_id: site.id,
			visitor_id: visitorId,
			first_seen: ts,
			last_seen: ts,
			country,
			region,
			city,
			device_type: null,
			browser: null,
			os: null,
			total_sessions: 0,
			total_pageviews: 0,
			total_revenue: excludedReason ? 0 : input.revenue,
			fingerprint: null,
		})
		.onConflict((oc) =>
			oc.columns(["site_id", "visitor_id"]).doUpdateSet({
				last_seen: ts,
				total_revenue: excludedReason ? undefined : sql`total_revenue + ${input.revenue}`,
			}),
		)
		.execute();

	return { eventId, visitorId, duplicate: false };
}

/**
 * Merge the confirmed sale into the browser-reported row (the order's amount
 * replaces the list price, and the visitor's lifetime revenue follows); false
 * when the order id is already booked.
 */
async function adoptClientConversion(
	db: Kysely<KlikapaDatabase>,
	row: {
		id: string;
		visitor_id: string;
		props: string | null;
		product: string | null;
		revenue: number;
	},
	input: ServerEventInput,
	patch: NetPatch,
): Promise<boolean> {
	let previous: Record<string, unknown> = {};
	try {
		previous = row.props ? (JSON.parse(row.props) as Record<string, unknown>) : {};
	} catch {
		/* unreadable props are replaced */
	}
	const supplied = Object.fromEntries(
		Object.entries(input.props ?? {}).filter(([, value]) => value !== null && value !== undefined),
	);
	try {
		const updated = await db
			.updateTable("events")
			.set({
				external_id: input.externalId,
				revenue: input.revenue,
				rail: patch.rail,
				net_revenue: patch.net_revenue,
				net_source: patch.net_source,
				fx_rate: patch.fx_rate,
				fx_date: patch.fx_date,
				fx_status: patch.fx_status,
				payment_provider: input.source,
				// The browser's product slug beats the order's display name.
				product: row.product ?? resolveProduct(input.product, { ...supplied, ...previous }),
				props: JSON.stringify({
					...supplied,
					...previous,
					external_id: input.externalId,
					source: input.source,
				}),
			})
			.where("id", "=", row.id)
			.where("external_id", "is", null)
			.returning("id")
			.executeTakeFirst();
		if (updated === undefined) return false;
		if (input.revenue !== row.revenue) {
			await db
				.updateTable("visitor_profiles")
				.set({ total_revenue: sql`MAX(0, total_revenue + ${input.revenue - row.revenue})` })
				.where("site_id", "=", input.siteId)
				.where("visitor_id", "=", row.visitor_id)
				.execute();
		}
		return true;
	} catch {
		// The order id won the unique index in a concurrent delivery.
		return false;
	}
}
