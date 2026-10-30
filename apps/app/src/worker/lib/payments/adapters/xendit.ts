import { mapXenditMethod } from "../../webhook-utils";
import { toNumber } from "../money";
import type { PaymentAdapter, PaymentLeg } from "../types";
import {
	attributionFromMetadata,
	isSandboxConfig,
	metadataBlock,
	toIso,
	verifyHeaderToken,
} from "./shared";

interface XenditPayload {
	event?: string;
	event_type?: string;
	data?: XenditObject | null;
	metadata?: Record<string, string | undefined>;
	[key: string]: unknown;
}

interface XenditObject {
	id?: string;
	external_id?: string;
	amount?: number | string | null;
	currency?: string | null;
	payment_method?: string | null;
	payment_channel?: string | null;
	recurring_payment_id?: string | null;
	status?: string;
	paid_at?: string | null;
	created?: string | null;
	invoice_id?: string | null;
	payment_id?: string | null;
	payment_request_id?: string | null;
	reference_id?: string | null;
	metadata?: Record<string, string | undefined>;
}

const PAID_STATUSES = new Set(["PAID", "SETTLED"]);
const REFUND_OK = new Set(["SUCCEEDED", "COMPLETED"]);

/** Xendit wraps the object in `data` for events and posts a bare invoice for legacy callbacks. */
function objectOf(body: Record<string, unknown>): XenditObject {
	const payload = body as XenditPayload;
	return (payload.data ?? (payload as XenditObject)) as XenditObject;
}

const eventName = (body: Record<string, unknown>): string => {
	const payload = body as XenditPayload;
	return payload.event ?? payload.event_type ?? "";
};

function metadataOf(body: Record<string, unknown>) {
	return metadataBlock(objectOf(body).metadata, (body as XenditPayload).metadata);
}

/**
 * Xendit: an invoice is a sale keyed by its id, `recurring.cycle.succeeded` a renewal keyed
 * by the cycle id, `refund.succeeded` a refund carrying its own id and naming the invoice or
 * payment it reverses. A body whose status is not PAID/SETTLED is never counted, whatever
 * the event name says.
 */
export const xenditAdapter: PaymentAdapter = {
	provider: "xendit",

	siteId(body) {
		return metadataOf(body).revklik_site_id ?? null;
	},

	saleIds(body) {
		const o = objectOf(body);
		return [o.invoice_id, o.payment_id, o.payment_request_id, o.reference_id].filter(
			(id): id is string => !!id,
		);
	},

	async verify(ctx, config) {
		return verifyHeaderToken(ctx, config.webhook_secret ?? "", "x-callback-token");
	},

	async parse(ctx, config) {
		const event = eventName(ctx.body);
		const o = objectOf(ctx.body);
		const meta = metadataOf(ctx.body);
		const common = {
			currency: o.currency ?? "IDR",
			test: isSandboxConfig(config),
			method: mapXenditMethod(
				o.payment_method ?? "unknown",
				o.payment_channel ?? o.payment_method ?? "unknown",
			),
			...attributionFromMetadata(meta),
		};

		if (event === "refund.succeeded" || event === "refund.completed") {
			if (o.status && !REFUND_OK.has(o.status.toUpperCase()))
				return { ignored: `refund_${o.status}` };
			const leg: PaymentLeg = {
				...common,
				kind: "refund",
				saleId: o.invoice_id || o.payment_id || o.payment_request_id || o.reference_id || "",
				refundId: o.id,
				amount: toNumber(o.amount) ?? 0,
				recurring: false,
				occurredAt: null,
				props: { xendit_refund_id: o.id ?? null },
			};
			return { legs: [leg], label: event };
		}

		const isCycle = event.startsWith("recurring.cycle");
		if (isCycle && event !== "recurring.cycle" && event !== "recurring.cycle.succeeded") {
			return { ignored: event };
		}
		const status = (o.status ?? "").toUpperCase();
		const paidEvent = event === "invoice.paid" || isCycle;
		if (status ? !PAID_STATUSES.has(status) && !(isCycle && status === "SUCCEEDED") : !paidEvent) {
			return { ignored: event || status.toLowerCase() || "unknown" };
		}
		const recurringId = o.recurring_payment_id ?? null;
		const leg: PaymentLeg = {
			...common,
			kind: "sale",
			saleId: o.id || o.external_id || "",
			amount: toNumber(o.amount) ?? 0,
			recurring: isCycle || !!recurringId,
			occurredAt: toIso(o.paid_at) ?? toIso(o.created),
			props: {
				xendit_invoice_id: o.id ?? null,
				external_id: o.external_id ?? null,
				payment_channel: o.payment_channel ?? null,
				...(recurringId ? { recurring_payment_id: recurringId, subscription_id: recurringId } : {}),
			},
		};
		return { legs: [leg], label: event || "paid" };
	},
};
