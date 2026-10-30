import { toNumber } from "../money";
import { type PaymentAdapter, type PaymentLeg, RetryableDeliveryError } from "../types";
import {
	attributionFromMetadata,
	isSandboxConfig,
	metadataBlock,
	toIso,
	verifyHeaderToken,
} from "./shared";

interface PaywuzTransaction {
	orderId?: string;
	status?: string;
	amount?: number;
	paymentMethod?: string | null;
	paidAt?: string | null;
}

interface PaywuzBody {
	metadata?: Record<string, string | undefined>;
	data?: (Record<string, unknown> & { metadata?: Record<string, string | undefined> }) | null;
	orderId?: string;
	order_id?: string;
	transaction_id?: string;
	payment_method?: string;
	paymentMethod?: string;
	paidAt?: string;
	status?: string;
	amount?: number;
}

const PAID = new Set(["success", "paid", "settled"]);
const REFUNDED = new Set(["refunded", "refund"]);

const bodyOf = (body: Record<string, unknown>): PaywuzBody => body as PaywuzBody;
const metadataOf = (body: Record<string, unknown>) =>
	metadataBlock(bodyOf(body).metadata, bodyOf(body).data?.metadata);

export const paywuzOrderId = (body: Record<string, unknown>): string => {
	const b = bodyOf(body);
	return String(b.data?.orderId ?? b.orderId ?? b.order_id ?? b.transaction_id ?? "");
};

/** The order as Paywuz reports it; null when Paywuz rejects the key or does not know the order. */
async function fetchTransaction(
	apiKey: string,
	orderId: string,
	fetchImpl: typeof fetch = fetch,
): Promise<PaywuzTransaction | null> {
	let res: Response;
	try {
		res = await fetchImpl(`https://api.paywuz.id/v1/transactions/${encodeURIComponent(orderId)}`, {
			headers: { Authorization: `Bearer ${apiKey}` },
		});
	} catch {
		throw new RetryableDeliveryError("Paywuz API unreachable");
	}
	if (res.status === 401 || res.status === 403 || res.status === 404) return null;
	if (!res.ok) throw new RetryableDeliveryError(`Paywuz API answered ${res.status}`);
	const json = (await res.json().catch(() => null)) as { data?: PaywuzTransaction } | null;
	return json?.data ?? null;
}

/**
 * Paywuz: the webhook secret (x-webhook-token) is required. With an API key the order is
 * re-read from Paywuz and its status/amount are authoritative. An absent status never counts as paid.
 */
export const paywuzAdapter: PaymentAdapter = {
	provider: "paywuz",

	siteId(body) {
		return metadataOf(body).revklik_site_id ?? null;
	},

	saleIds(body) {
		const id = paywuzOrderId(body);
		return id ? [id] : [];
	},

	async verify(ctx, config) {
		return verifyHeaderToken(ctx, config.webhook_secret ?? "", "x-webhook-token");
	},

	async parse(ctx, config) {
		const b = bodyOf(ctx.body);
		const orderId = paywuzOrderId(ctx.body);
		if (!orderId) return { error: "Cannot resolve order id" };

		const apiKey = config.api_key ?? "";
		let tx: PaywuzTransaction | null = null;
		if (apiKey) {
			tx = await fetchTransaction(apiKey, orderId);
			if (!tx) return { error: "Verification failed", status: 401 };
		}
		const status = String(tx?.status ?? b.data?.status ?? b.status ?? "").toLowerCase();
		const refunded = REFUNDED.has(status);
		if (!PAID.has(status) && !refunded) return { ignored: "not_paid" };

		const leg: PaymentLeg = {
			kind: refunded ? "refund" : "sale",
			saleId: orderId,
			amount: toNumber(tx?.amount ?? b.data?.amount ?? b.amount) ?? 0,
			currency: "IDR",
			test: isSandboxConfig(config),
			recurring: false,
			method: String(
				tx?.paymentMethod ??
					b.data?.payment_method ??
					b.data?.paymentMethod ??
					b.payment_method ??
					b.paymentMethod ??
					"unknown",
			).toLowerCase(),
			occurredAt: refunded ? null : toIso(tx?.paidAt ?? b.data?.paidAt ?? b.paidAt),
			...attributionFromMetadata(metadataOf(ctx.body)),
			props: { paywuz_order_id: orderId },
		};
		return { legs: [leg], label: refunded ? "refunded" : "paid" };
	},
};
