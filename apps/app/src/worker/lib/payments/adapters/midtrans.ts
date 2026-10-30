import { verifyMidtransSignature, parseMidtransPaymentMethod } from "../../webhook-utils";
import { toNumber } from "../money";
import type { PaymentAdapter, PaymentLeg } from "../types";
import { NO_SECRET } from "./shared";

interface MidtransNotification {
	order_id?: string;
	status_code?: string;
	gross_amount?: string;
	signature_key?: string;
	transaction_status?: string;
	fraud_status?: string;
	payment_type?: string;
	transaction_time?: string;
	currency?: string;
	refund_amount?: string | number;
	custom_field1?: string;
	custom_field2?: string;
	custom_field3?: string;
	custom_field4?: string;
}

const WIB_OFFSET = "+07:00";
const REFUND_STATUSES = new Set(["refund", "partial_refund", "chargeback"]);

const bodyOf = (body: Record<string, unknown>): MidtransNotification =>
	body as MidtransNotification;

/** Midtrans prints transaction_time as "YYYY-MM-DD HH:mm:ss" in WIB, with no offset. */
export function midtransTime(value: string | undefined): string | null {
	if (!value) return null;
	const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/.exec(value.trim());
	const ms = new Date(match ? `${match[1]}T${match[2]}${WIB_OFFSET}` : value).getTime();
	return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** A sandbox server key starts with `SB-`; the saved Production Mode flag decides for any other key. */
function isTestKey(config: Record<string, string>): boolean {
	const key = config.server_key ?? "";
	if (key.startsWith("SB-")) return true;
	if (key.startsWith("Mid-server-")) return false;
	return ["false", "0", "no"].includes((config.is_production ?? "").toLowerCase());
}

/**
 * Midtrans: `settlement` (and an accepted card `capture`) is a sale keyed by the order id, so a
 * card's capture followed by its settlement books once. `refund`/`partial_refund` carry the
 * running refunded total; `chargeback` reverses the full amount.
 */
export const midtransAdapter: PaymentAdapter = {
	provider: "midtrans",

	siteId(body) {
		return bodyOf(body).custom_field4 || null;
	},

	saleIds(body) {
		const id = bodyOf(body).order_id;
		return id ? [id] : [];
	},

	async verify(ctx, config) {
		const n = bodyOf(ctx.body);
		const serverKey = config.server_key ?? "";
		if (!serverKey) return NO_SECRET;
		const signature = (n.signature_key ?? "").toLowerCase();
		if (!signature) {
			return {
				ok: false,
				status: 401,
				label: "missing_sig",
				reason: "missing_signature",
				message: "Missing signature",
			};
		}
		const valid = await verifyMidtransSignature(
			n.order_id ?? "",
			n.status_code ?? "",
			n.gross_amount ?? "",
			serverKey,
			signature,
		);
		return valid
			? { ok: true }
			: {
					ok: false,
					status: 401,
					label: "invalid_sig",
					reason: "invalid_signature",
					message: "Invalid signature",
				};
	},

	async parse(ctx, config) {
		const n = bodyOf(ctx.body);
		const status = n.transaction_status ?? "";
		const orderId = n.order_id ?? "";
		const gross = toNumber(n.gross_amount) ?? 0;
		const paymentType = n.payment_type ?? "unknown";
		const common = {
			currency: n.currency ?? "IDR",
			test: isTestKey(config),
			recurring: false,
			method: parseMidtransPaymentMethod(paymentType),
			visitorId: null,
			sessionId: n.custom_field1 || null,
			utmSource: n.custom_field2 || null,
			utmMedium: null,
			utmCampaign: n.custom_field3 || null,
			props: { order_id: orderId, payment_type: paymentType },
		} satisfies Partial<PaymentLeg>;

		if (status === "settlement" || status === "capture") {
			if (status === "capture" && n.fraud_status && n.fraud_status !== "accept") {
				return { ignored: `fraud_${n.fraud_status}` };
			}
			const leg: PaymentLeg = {
				...common,
				kind: "sale",
				saleId: orderId,
				amount: gross,
				occurredAt: midtransTime(n.transaction_time),
			};
			return { legs: [leg], label: status };
		}

		if (REFUND_STATUSES.has(status)) {
			const refunded =
				status === "partial_refund"
					? toNumber(n.refund_amount)
					: (toNumber(n.refund_amount) ?? gross);
			if (!refunded) return { ignored: `${status}_unknown_amount` };
			const leg: PaymentLeg = {
				...common,
				kind: "refund",
				cumulative: true,
				saleId: orderId,
				amount: refunded,
				occurredAt: null,
			};
			return { legs: [leg], label: status };
		}

		return { ignored: status || "unknown" };
	},
};
