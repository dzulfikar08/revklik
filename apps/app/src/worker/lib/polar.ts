import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { isValidReportedNet } from "./fees";
import { recordServerEvent } from "./server-events";

/** Subset of a Polar order payload read by this helper. */
export interface PolarOrder {
	id: string;
	status?: string;
	total_amount?: number | null;
	net_amount?: number | null;
	refunded_amount?: number | null;
	/** What Polar kept from the order, in cents of `platform_fee_currency`. */
	platform_fee_amount?: number | null;
	platform_fee_currency?: string | null;
	currency?: string;
	created_at?: string;
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

/** Process a single Polar order: books the sale (and any refund) once, keyed by the order id. */
export async function processPolarOrder(
	db: Kysely<KlikapaDatabase>,
	order: PolarOrder,
	siteId: string,
): Promise<"imported" | "skipped" | "refunded"> {
	const site = await db
		.selectFrom("sites")
		.select(["id", "revenue_currency"])
		.where("id", "=", siteId)
		.executeTakeFirst();
	if (!site) return "skipped";

	// net_amount is after discounts and before tax: what the business earned.
	const cents = order.net_amount ?? order.total_amount ?? 0;
	const amount = cents / 100;
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

	const sale = await recordServerEvent(db, site, {
		siteId,
		name: isRecurring ? "subscription_payment" : "one_time_purchase",
		revenue: amount,
		currency: (order.currency ?? "usd").toUpperCase(),
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
	});
	if (!sale.duplicate) {
		await db
			.updateTable("visitor_profiles")
			.set({ name: customerName, email: customerEmail })
			.where("site_id", "=", siteId)
			.where("visitor_id", "=", sale.visitorId)
			.execute();
	}

	const refundedCents = order.refunded_amount ?? (order.status === "refunded" ? cents : 0);
	if (refundedCents > 0) {
		const refund = await recordServerEvent(db, site, {
			siteId,
			name: "refund",
			revenue: -(refundedCents / 100),
			currency: (order.currency ?? "usd").toUpperCase(),
			externalId: `${order.id}:refund`,
			source: "polar",
			rail: "polar",
			props,
			occurredAt: order.created_at,
			visitorId: sale.visitorId,
		});
		if (!refund.duplicate) return "refunded";
	}
	return sale.duplicate ? "skipped" : "imported";
}
