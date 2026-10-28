import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { sql } from "../db";
import { generateId } from "../utils";
import { normalizeRail, railFromSource, resolveNet, resolveProduct } from "./fees";
import { eventCurrency, MAX_REVENUE, resolveEventTimestamp } from "./ingest";

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
}

export interface ServerEventResult {
	eventId: string;
	visitorId: string;
	duplicate: boolean;
}

export interface ServerEventSite {
	id: string;
	revenue_currency?: string;
}

/** Event type by sign: sale, refund, or a plain event when no money moved. */
function eventTypeFor(revenue: number): "conversion" | "refund" | "custom" {
	if (revenue > 0) return "conversion";
	if (revenue < 0) return "refund";
	return "custom";
}

const COUNTRY_RE = /^[A-Za-z]{2}$/;
const REFUND_SUFFIX = ":refund";

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

	const findExisting = () =>
		db
			.selectFrom("events")
			.select(["id", "visitor_id"])
			.where("site_id", "=", site.id)
			.where("external_id", "=", input.externalId)
			.executeTakeFirst();
	const existing = await findExisting();
	if (existing) return { eventId: existing.id, visitorId: existing.visitor_id, duplicate: true };

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
	if (!visitorId && input.externalId.endsWith(REFUND_SUFFIX)) {
		const sale = await db
			.selectFrom("events")
			.select(["visitor_id", "session_id"])
			.where("site_id", "=", site.id)
			.where("external_id", "=", input.externalId.slice(0, -REFUND_SUFFIX.length))
			.executeTakeFirst();
		if (sale) {
			visitorId = sale.visitor_id;
			sessionId ??= sale.session_id;
		}
	}
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
		visitorId = `${input.source}_${input.externalId.replace(/[^a-zA-Z0-9]/g, "_")}`.slice(0, 120);
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
	const eventType = eventTypeFor(input.revenue);
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
				path: `/${input.source}`,
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
				payment_provider: input.source,
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
			total_revenue: input.revenue,
			fingerprint: null,
		})
		.onConflict((oc) =>
			oc.columns(["site_id", "visitor_id"]).doUpdateSet({
				last_seen: ts,
				total_revenue: sql`total_revenue + ${input.revenue}`,
			}),
		)
		.execute();

	return { eventId, visitorId, duplicate: false };
}
