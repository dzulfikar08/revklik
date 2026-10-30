import { mapStripePaymentMethod, verifyStripeSignature } from "../../webhook-utils";
import { minorToMajor, toNumber } from "../money";
import type { PaymentAdapter, PaymentLeg } from "../types";

type Metadata = Record<string, string | undefined>;

interface StripeObject {
	id?: string;
	object?: string;
	metadata?: Metadata | null;
	livemode?: boolean;
	currency?: string | null;
	created?: number | null;
	// checkout.session
	payment_status?: string | null;
	amount_total?: number | null;
	payment_intent?: string | null;
	invoice?: string | null;
	subscription?: string | null;
	mode?: string | null;
	payment_method_types?: string[] | null;
	// invoice
	amount_paid?: number | null;
	billing_reason?: string | null;
	payment_settings?: { payment_method_types?: string[] | null } | null;
	subscription_details?: { metadata?: Metadata | null } | null;
	parent?: {
		subscription_details?: { metadata?: Metadata | null; subscription?: string | null } | null;
	} | null;
	status_transitions?: { paid_at?: number | null } | null;
	// charge
	amount?: number | null;
	amount_refunded?: number | null;
	payment_method_details?: { type?: string | null } | null;
}

interface StripeEvent {
	type?: string;
	livemode?: boolean;
	created?: number;
	data?: { object?: StripeObject | null } | null;
}

const PAID_CHECKOUT = new Set([
	"checkout.session.completed",
	"checkout.session.async_payment_succeeded",
]);
const PAID_INVOICE = new Set(["invoice.paid", "invoice.payment_succeeded"]);

const eventOf = (body: Record<string, unknown>): StripeEvent => body as StripeEvent;
const objectOf = (body: Record<string, unknown>): StripeObject => eventOf(body).data?.object ?? {};

/** Checkout metadata, or the subscription metadata an invoice inherits. */
function metadataOf(obj: StripeObject): Metadata {
	return {
		...obj.parent?.subscription_details?.metadata,
		...obj.subscription_details?.metadata,
		...obj.metadata,
	};
}

const unixToIso = (seconds: number | null | undefined): string | null =>
	typeof seconds === "number" && Number.isFinite(seconds)
		? new Date(seconds * 1000).toISOString()
		: null;

function attribution(meta: Metadata) {
	return {
		visitorId: meta.revklik_visitor_id ?? null,
		sessionId: meta.revklik_session_id ?? null,
		utmSource: meta.revklik_utm_source ?? meta.utm_source ?? null,
		utmMedium: meta.revklik_utm_medium ?? meta.utm_medium ?? null,
		utmCampaign: meta.revklik_utm_campaign ?? meta.utm_campaign ?? null,
	};
}

function isTest(event: StripeEvent, obj: StripeObject): boolean {
	return (event.livemode ?? obj.livemode) === false;
}

/**
 * Stripe: the money is on the Checkout Session (first payment of a payment-mode checkout),
 * the Invoice (every subscription payment, including renewals) and the Charge (refunds).
 * A subscription's first payment arrives as both a session and an invoice; both key on the
 * invoice id, so it books once. Amounts are minor units in the currency's own exponent and
 * include tax, as do refunds, so a refund always reverses what the sale booked.
 */
export const stripeAdapter: PaymentAdapter = {
	provider: "stripe",

	siteId(body) {
		return metadataOf(objectOf(body)).revklik_site_id ?? null;
	},

	saleIds(body) {
		const obj = objectOf(body);
		return [obj.invoice, obj.payment_intent, obj.id].filter((id): id is string => !!id);
	},

	async verify(ctx, config) {
		const secret = config.webhook_secret ?? "";
		if (!secret) {
			return {
				ok: false,
				status: 401,
				label: "no_secret",
				reason: "no_secret",
				message: "Webhook secret not configured for this integration",
			};
		}
		const header = ctx.header("stripe-signature");
		if (!header || !(await verifyStripeSignature(ctx.rawBody, header, secret))) {
			return {
				ok: false,
				status: 401,
				label: "invalid_sig",
				reason: "invalid_signature",
				message: "Invalid signature",
			};
		}
		return { ok: true };
	},

	async parse(ctx) {
		const event = eventOf(ctx.body);
		const type = event.type ?? "";
		const obj = objectOf(ctx.body);
		const currency = (obj.currency ?? "").toUpperCase();
		const test = isTest(event, obj);
		const meta = metadataOf(obj);
		const base = {
			currency,
			test,
			...attribution(meta),
		};

		if (PAID_CHECKOUT.has(type)) {
			if (obj.payment_status !== "paid") return { ignored: `${type}_unpaid` };
			const amount = minorToMajor(obj.amount_total ?? 0, currency);
			if (!(amount > 0)) return { ignored: `${type}_no_money` };
			const method = mapStripePaymentMethod(obj.payment_method_types?.[0] ?? "card");
			const leg: PaymentLeg = {
				...base,
				kind: "sale",
				saleId: obj.invoice || obj.payment_intent || obj.id || "",
				amount,
				recurring: obj.mode === "subscription" || !!obj.subscription,
				method,
				occurredAt: unixToIso(event.created),
				props: {
					stripe_session_id: obj.id ?? null,
					...(obj.subscription ? { subscription_id: obj.subscription } : {}),
				},
			};
			return { legs: [leg], label: type };
		}

		if (PAID_INVOICE.has(type)) {
			const amount = minorToMajor(obj.amount_paid ?? 0, currency);
			if (!(amount > 0)) return { ignored: `${type}_no_money` };
			const subscription =
				obj.subscription ?? obj.parent?.subscription_details?.subscription ?? null;
			const leg: PaymentLeg = {
				...base,
				kind: "sale",
				saleId: obj.id ?? "",
				amount,
				recurring: !!obj.billing_reason && obj.billing_reason.startsWith("subscription"),
				method: mapStripePaymentMethod(obj.payment_settings?.payment_method_types?.[0] ?? "card"),
				occurredAt: unixToIso(obj.status_transitions?.paid_at) ?? unixToIso(event.created),
				props: {
					stripe_invoice_id: obj.id ?? null,
					billing_reason: obj.billing_reason ?? null,
					...(subscription ? { subscription_id: subscription } : {}),
				},
			};
			return { legs: [leg], label: type };
		}

		if (type === "charge.refunded") {
			// amount_refunded is the running total over all refunds of the charge.
			const refunded = toNumber(obj.amount_refunded) ?? 0;
			const amount = minorToMajor(refunded, currency);
			if (!(amount > 0)) return { ignored: `${type}_no_money` };
			const leg: PaymentLeg = {
				...base,
				kind: "refund",
				cumulative: true,
				saleId: obj.invoice || obj.payment_intent || obj.id || "",
				amount,
				recurring: false,
				method: mapStripePaymentMethod(obj.payment_method_details?.type ?? "card"),
				occurredAt: null,
				props: { stripe_charge_id: obj.id ?? null },
			};
			return { legs: [leg], label: type };
		}

		return { ignored: type || "unknown" };
	},
};
