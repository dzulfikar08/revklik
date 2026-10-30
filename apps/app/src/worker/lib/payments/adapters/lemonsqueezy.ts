import { verifyLemonSqueezySignature } from "../../webhook-utils";
import { toNumber } from "../money";
import type { PaymentAdapter, PaymentLeg } from "../types";

interface LemonSqueezyBody {
	meta?: {
		event_name?: string;
		test_mode?: boolean;
		custom_data?: Record<string, string | undefined> | null;
	} | null;
	data?: {
		id?: string | number;
		attributes?: LemonSqueezyAttributes | null;
	} | null;
}

interface LemonSqueezyAttributes {
	status?: string | null;
	total?: number | string | null;
	currency?: string | null;
	refunded_amount?: number | string | null;
	subscription_id?: number | string | null;
	billing_reason?: string | null;
	test_mode?: boolean | null;
	created_at?: string | null;
}

/** Order states that carry money: paid, or paid and later (partly) refunded. */
const BOOKABLE_ORDER_STATUS = new Set(["paid", "refunded", "partial_refund"]);
const CENTS = 100;

const bodyOf = (body: Record<string, unknown>): LemonSqueezyBody => body as LemonSqueezyBody;

/**
 * LemonSqueezy: an order books on `order_created`, a renewal on
 * `subscription_payment_success`, refunds on `order_refunded` and
 * `subscription_payment_refunded` (running refunded total, in cents). A subscription's
 * first payment also fires `subscription_created` and an `initial` payment event; both
 * are the same money as the order and are ignored. Order and invoice ids are separate
 * id spaces, so each is namespaced.
 */
export const lemonSqueezyAdapter: PaymentAdapter = {
	provider: "lemonsqueezy",

	siteId(body) {
		return bodyOf(body).meta?.custom_data?.revklik_site_id ?? null;
	},

	saleIds(body) {
		const id = bodyOf(body).data?.id;
		return id === undefined ? [] : [`order-${id}`, `invoice-${id}`];
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
		const signature = ctx.header("x-signature");
		if (!signature || !(await verifyLemonSqueezySignature(ctx.rawBody, signature, secret))) {
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
		const body = bodyOf(ctx.body);
		const eventName = body.meta?.event_name ?? "";
		const id = body.data?.id;
		const attrs = body.data?.attributes ?? {};
		const meta = body.meta?.custom_data ?? {};
		const common = {
			currency: (attrs.currency ?? "").toUpperCase(),
			test: body.meta?.test_mode === true || attrs.test_mode === true,
			recurring: false,
			method: "lemonsqueezy",
			visitorId: meta.revklik_visitor_id ?? null,
			sessionId: meta.revklik_session_id ?? null,
			utmSource: meta.revklik_utm_source ?? meta.utm_source ?? null,
			utmMedium: meta.revklik_utm_medium ?? meta.utm_medium ?? null,
			utmCampaign: meta.revklik_utm_campaign ?? meta.utm_campaign ?? null,
		};
		if (id === undefined || id === "") return { error: "Missing order id" };

		if (eventName === "order_created") {
			if (!BOOKABLE_ORDER_STATUS.has(attrs.status ?? ""))
				return { ignored: `${eventName}_${attrs.status ?? "unpaid"}` };
			const leg: PaymentLeg = {
				...common,
				kind: "sale",
				saleId: `order-${id}`,
				amount: (toNumber(attrs.total) ?? 0) / CENTS,
				occurredAt: attrs.created_at ?? null,
				props: { lemonsqueezy_order_id: String(id) },
			};
			return { legs: [leg], label: eventName };
		}

		if (eventName === "subscription_payment_success") {
			// The initial payment is the order that created the subscription.
			if (attrs.billing_reason === "initial") return { ignored: `${eventName}_initial` };
			if (attrs.status && attrs.status !== "paid")
				return { ignored: `${eventName}_${attrs.status}` };
			const leg: PaymentLeg = {
				...common,
				kind: "sale",
				saleId: `invoice-${id}`,
				amount: (toNumber(attrs.total) ?? 0) / CENTS,
				recurring: true,
				occurredAt: attrs.created_at ?? null,
				props: {
					lemonsqueezy_invoice_id: String(id),
					subscription_id:
						attrs.subscription_id === undefined ? null : String(attrs.subscription_id),
				},
			};
			return { legs: [leg], label: eventName };
		}

		if (eventName === "order_refunded" || eventName === "subscription_payment_refunded") {
			const isInvoice = eventName === "subscription_payment_refunded";
			if (isInvoice && attrs.billing_reason === "initial")
				return { ignored: `${eventName}_initial` };
			const refunded = toNumber(attrs.refunded_amount) ?? toNumber(attrs.total) ?? 0;
			const leg: PaymentLeg = {
				...common,
				kind: "refund",
				cumulative: true,
				saleId: `${isInvoice ? "invoice" : "order"}-${id}`,
				amount: refunded / CENTS,
				occurredAt: null,
				props: { lemonsqueezy_refund_of: String(id) },
			};
			return { legs: [leg], label: eventName };
		}

		return { ignored: eventName || "unknown" };
	},
};
