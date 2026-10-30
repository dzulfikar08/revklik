import { toNumber } from "../money";
import { type PaymentAdapter, type PaymentLeg, RetryableDeliveryError } from "../types";
import {
	attributionFromMetadata,
	isSandboxConfig,
	metadataBlock,
	toIso,
	verifyHeaderToken,
} from "./shared";

interface MayarTransaction {
	id: string;
	credit?: number;
	status?: string;
	paymentMethod?: string | null;
	createdAt?: number | null;
	subscriptionId?: string | null;
	amount?: number;
}

interface MayarBody {
	event?: string;
	metadata?: Record<string, string | undefined>;
	data?: (Record<string, unknown> & { metadata?: Record<string, string | undefined> }) | null;
	id?: string;
	transaction_id?: string;
	payment_method?: string;
	status?: string;
	amount?: number;
}

const PAGE_SIZE = 100;
/** Transactions pages scanned for the delivery's id before it counts as "not visible yet". */
const MAX_PAGES = 10;
const PAID = new Set(["settled", "paid", "success"]);
const REFUNDED = new Set(["refunded", "refund"]);

const bodyOf = (body: Record<string, unknown>): MayarBody => body as MayarBody;
const metadataOf = (body: Record<string, unknown>) =>
	metadataBlock(bodyOf(body).metadata, bodyOf(body).data?.metadata);

export const mayarTransactionId = (body: Record<string, unknown>): string => {
	const b = bodyOf(body);
	return String(b.data?.id ?? b.id ?? b.transaction_id ?? "");
};

/**
 * The transaction as Mayar's API reports it, or null when Mayar answers but does not list it
 * (or rejects the key). A network or 5xx failure is retryable: the provider's retry is the cure.
 */
async function fetchTransaction(
	apiKey: string,
	apiVersion: string,
	txnId: string,
	fetchImpl: typeof fetch = fetch,
): Promise<MayarTransaction | null> {
	const base = apiVersion === "v2" ? "https://api.mayar.id/hl/v2" : "https://api.mayar.id/hl/v1";
	for (let page = 1; page <= MAX_PAGES; page++) {
		let res: Response;
		try {
			res = await fetchImpl(`${base}/transactions?page=${page}&pageSize=${PAGE_SIZE}`, {
				headers: { Authorization: `Bearer ${apiKey}` },
			});
		} catch {
			throw new RetryableDeliveryError("Mayar API unreachable");
		}
		if (res.status === 401 || res.status === 403) return null;
		if (!res.ok) throw new RetryableDeliveryError(`Mayar API answered ${res.status}`);
		const json = (await res.json().catch(() => null)) as { data?: MayarTransaction[] } | null;
		const rows = json?.data ?? [];
		const found = rows.find((t) => t.id === txnId);
		if (found) return found;
		if (rows.length < PAGE_SIZE) return null;
	}
	return null;
}

/**
 * Mayar: the webhook secret (x-webhook-token) is required. With an API key the transaction is
 * re-read from Mayar and its status/amount are authoritative; a status that is absent never
 * counts as paid (only the explicit `payment.received` event may stand in for it).
 */
export const mayarAdapter: PaymentAdapter = {
	provider: "mayar",

	siteId(body) {
		return metadataOf(body).revklik_site_id ?? null;
	},

	saleIds(body) {
		const id = mayarTransactionId(body);
		return id ? [id] : [];
	},

	async verify(ctx, config) {
		return verifyHeaderToken(ctx, config.webhook_secret ?? "", "x-webhook-token");
	},

	async parse(ctx, config) {
		const b = bodyOf(ctx.body);
		const txnId = mayarTransactionId(ctx.body);
		if (!txnId) return { error: "Cannot resolve transaction id" };

		const apiKey = config.api_key ?? "";
		let tx: MayarTransaction | null = null;
		if (apiKey) {
			tx = await fetchTransaction(apiKey, config.api_version === "v1" ? "v1" : "v2", txnId);
			if (!tx) return { error: "Verification failed", status: 401 };
		}
		const status = String(tx?.status ?? b.data?.status ?? b.status ?? "").toLowerCase();
		const paid = PAID.has(status) || (status === "" && b.event === "payment.received");
		const refunded = REFUNDED.has(status);
		if (!paid && !refunded) return { ignored: "not_paid" };

		const subscriptionId =
			tx?.subscriptionId ?? (b.data?.subscriptionId as string | undefined) ?? null;
		const method = String(
			tx?.paymentMethod ??
				b.data?.payment_method ??
				b.data?.paymentMethod ??
				b.payment_method ??
				"unknown",
		).toLowerCase();
		const leg: PaymentLeg = {
			kind: refunded ? "refund" : "sale",
			saleId: txnId,
			amount: toNumber(tx?.credit ?? tx?.amount ?? b.data?.amount ?? b.amount) ?? 0,
			currency: "IDR",
			test: isSandboxConfig(config),
			recurring: !!subscriptionId,
			method,
			occurredAt: refunded ? null : toIso(tx?.createdAt ?? b.data?.createdAt),
			...attributionFromMetadata(metadataOf(ctx.body)),
			props: {
				mayar_transaction_id: txnId,
				...(subscriptionId ? { subscription_id: subscriptionId } : {}),
			},
		};
		return { legs: [leg], label: refunded ? "refunded" : subscriptionId ? "subscription" : "paid" };
	},
};
