import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { isValidReportedNet, netByRefundRatio } from "./fees";
import { type ServerEventResult, recordServerEvent } from "./server-events";

/** Subset of a Polar order payload read by this helper. */
export interface PolarOrder {
	id: string;
	status?: string;
	/** Polar's own paid flag; absent on relayed or legacy payloads. */
	paid?: boolean | null;
	total_amount?: number | null;
	net_amount?: number | null;
	refunded_amount?: number | null;
	/** What Polar kept from the order, in cents of `platform_fee_currency`. */
	platform_fee_amount?: number | null;
	platform_fee_currency?: string | null;
	currency?: string;
	created_at?: string;
	/** Last change to the order; Polar sets it when a refund lands. */
	modified_at?: string | null;
	/** When the latest refund happened (event time, or the refund's own created_at). */
	refunded_at?: string | null;
	billing_name?: string | null;
	billing_reason?: string;
	customer?: {
		email?: string | null;
		name?: string | null;
		billing_address?: PolarAddress | null;
	} | null;
	billing_address?: PolarAddress | null;
	product?: { name?: string | null } | null;
	/** Checkout metadata Polar copies onto the order. */
	metadata?: Record<string, string | undefined> | null;
}

/**
 * Proceeds of a sale in major units: the order amount less Polar's platform fee.
 * Null (the fee rule applies instead) when Polar sent no fee, billed it in another
 * currency, or the result is not a valid net of the sale.
 */
export function polarReportedNet(
	amountCents: number,
	feeCents: number | null | undefined,
	currency: string | undefined,
	feeCurrency: string | null | undefined,
): number | null {
	if (typeof feeCents !== "number" || !Number.isFinite(feeCents) || feeCents < 0) return null;
	if (feeCurrency && currency && feeCurrency.toLowerCase() !== currency.toLowerCase()) return null;
	const net = (amountCents - feeCents) / 100;
	return isValidReportedNet(amountCents / 100, net) ? net : null;
}

interface PolarAddress {
	country?: string | null;
	state?: string | null;
	city?: string | null;
}

/** Order states that carry money: paid, or paid and later (partly) refunded. */
const BOOKABLE_STATUSES: Record<string, true> = {
	paid: true,
	partially_refunded: true,
	refunded: true,
};

/** False for draft, pending and void orders; a payload with no status is a relayed paid order. */
export function isBookablePolarOrder(order: Pick<PolarOrder, "status" | "paid">): boolean {
	if (order.status) return BOOKABLE_STATUSES[order.status] === true;
	return order.paid !== false;
}

/** Cents Polar says were refunded: the stated amount, else the whole net of a refunded order. */
export function polarRefundedCents(order: PolarOrder): number {
	const net = order.net_amount ?? order.total_amount ?? 0;
	return order.refunded_amount ?? (order.status === "refunded" ? net : 0);
}

export interface PolarBooking {
	/** The sale; null when the order is not bookable or carries no money. */
	sale: ServerEventResult | null;
	/** "new": the first refund row; "grown": a later refund added the amount Polar's total rose by. */
	refund: "new" | "grown" | "none";
	refundEventId: string | null;
}

const NO_BOOKING: PolarBooking = { sale: null, refund: "none", refundEventId: null };
/** Re-reads after a refund-step key collision; each lap means a concurrent delivery booked first. */
const REFUND_BOOKING_ATTEMPTS = 3;

/**
 * Book one Polar order: the sale once (keyed by the order id), and the refund as
 * a single negative `<id>:refund` row that rises to Polar's cumulative refunded
 * amount, because a second partial refund arrives as the same order with a
 * larger total.
 */
export async function bookPolarOrder(
	db: Kysely<KlikapaDatabase>,
	order: PolarOrder,
	siteId: string,
	env?: { FX_USD_IDR?: string },
): Promise<PolarBooking> {
	const site = await db
		.selectFrom("sites")
		.select(["id", "revenue_currency"])
		.where("id", "=", siteId)
		.executeTakeFirst();
	if (!site || !isBookablePolarOrder(order)) return NO_BOOKING;

	// net_amount is after discounts and before tax: what the business earned.
	const cents = order.net_amount ?? order.total_amount ?? 0;
	if (!Number.isFinite(cents) || cents <= 0) return NO_BOOKING;
	const amount = cents / 100;
	const currency = (order.currency ?? "usd").toUpperCase();
	const country =
		order.customer?.billing_address?.country ?? order.billing_address?.country ?? null;
	const customerEmail = order.customer?.email ?? null;
	const customerName = order.customer?.name ?? order.billing_name ?? null;
	const productName = order.product?.name ?? null;
	const billingReason = order.billing_reason ?? "purchase";
	const isRecurring = ["subscription_create", "subscription_cycle", "subscription_update"].includes(
		billingReason,
	);
	const props = {
		polar_order_id: order.id,
		product: productName,
		billing_reason: billingReason,
		customer_email: customerEmail,
		customer_name: customerName,
		...(country ? { country } : {}),
	};

	const sale = await recordServerEvent(
		db,
		site,
		{
			siteId,
			name: isRecurring ? "subscription_payment" : "one_time_purchase",
			revenue: amount,
			currency,
			externalId: order.id,
			source: "polar",
			rail: "polar",
			props,
			occurredAt: order.created_at,
			netRevenue: polarReportedNet(
				cents,
				order.platform_fee_amount,
				order.currency,
				order.platform_fee_currency,
			),
			visitorId: order.metadata?.revklik_visitor_id ?? null,
			sessionId: order.metadata?.revklik_session_id ?? null,
			utmSource: order.metadata?.utm_source ?? null,
			utmMedium: order.metadata?.utm_medium ?? null,
			utmCampaign: order.metadata?.utm_campaign ?? null,
		},
		env,
	);
	if (!sale.duplicate && (customerEmail || customerName)) {
		await db
			.updateTable("visitor_profiles")
			.set({
				...(customerName ? { name: customerName } : {}),
				...(customerEmail ? { email: customerEmail } : {}),
			})
			.where("site_id", "=", siteId)
			.where("visitor_id", "=", sale.visitorId)
			.execute();
	}

	const refundedCents = polarRefundedCents(order);
	if (!(refundedCents > 0)) return { sale, refund: "none", refundEventId: null };

	// A refund step is keyed by the total already booked before it, so two deliveries that read
	// the same total (a webhook racing the sync) collide on the unique key instead of both
	// booking; the loser re-reads and books only what is still missing.
	for (let attempt = 0; attempt < REFUND_BOOKING_ATTEMPTS; attempt++) {
		// Naming is_bot opts out of the bot filter, which would hide an excluded (test) refund row.
		const booked = await db
			.selectFrom("events")
			.select(["revenue"])
			.where("site_id", "=", siteId)
			.where((eb) =>
				eb.or([
					eb("external_id", "=", `${order.id}:refund`),
					eb("external_id", "like", `${order.id}~%:refund`),
				]),
			)
			.where("is_bot", "in", [0, 1])
			.execute();
		const bookedCents = booked.reduce((sum, row) => sum + Math.round(-(row.revenue ?? 0) * 100), 0);
		const deltaCents = refundedCents - bookedCents;
		// Polar reports the cumulative total: a replay or an older event adds nothing.
		if (deltaCents <= 0) return { sale, refund: "none", refundEventId: null };

		// The first refund keeps the `<id>:refund` key; each later one adds the amount Polar's
		// total rose by, so it lands on the day it happened.
		const isFirst = booked.length === 0;
		const refundRevenue = -(deltaCents / 100);
		const saleRow = isFirst
			? undefined
			: await db
					.selectFrom("events")
					.select(["revenue", "net_revenue"])
					.where("site_id", "=", siteId)
					.where("external_id", "=", order.id)
					.where("is_bot", "in", [0, 1])
					.executeTakeFirst();
		const ratioNet = netByRefundRatio(refundRevenue, saleRow);
		const refund = await recordServerEvent(
			db,
			site,
			{
				siteId,
				name: "refund",
				revenue: refundRevenue,
				currency,
				externalId: isFirst ? `${order.id}:refund` : `${order.id}~${bookedCents}:refund`,
				source: "polar",
				rail: "polar",
				props,
				// The refund's own time; the order's creation date only when Polar gave nothing newer.
				occurredAt: order.refunded_at ?? order.modified_at ?? order.created_at,
				netRevenue: ratioNet,
				visitorId: sale.visitorId,
			},
			env,
		);
		if (refund.duplicate) continue;
		if (ratioNet !== null) {
			await db
				.updateTable("events")
				.set({ net_source: "refund_ratio" })
				.where("id", "=", refund.eventId)
				.where("is_bot", "in", [0, 1])
				.execute();
		}
		return { sale, refund: isFirst ? "new" : "grown", refundEventId: refund.eventId };
	}
	return { sale, refund: "none", refundEventId: null };
}

/** Process a single Polar order: books the sale (and any refund) once, keyed by the order id. */
export async function processPolarOrder(
	db: Kysely<KlikapaDatabase>,
	order: PolarOrder,
	siteId: string,
	env?: { FX_USD_IDR?: string },
): Promise<"imported" | "skipped" | "refunded"> {
	const booking = await bookPolarOrder(db, order, siteId, env);
	if (booking.refund !== "none") return "refunded";
	return booking.sale && !booking.sale.duplicate ? "imported" : "skipped";
}
