import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";

/** One thing a delivery books: a sale, or a refund of an earlier sale. */
export interface PaymentLeg {
	kind: "sale" | "refund";
	/**
	 * The provider's id of the sale (a refund names the sale it reverses). The
	 * idempotency key is `<provider>:<saleId>`, so one provider transaction can
	 * never be booked twice, whatever event types announce it.
	 */
	saleId: string;
	/** Refunds: distinguishes several refunds of one sale that each carry an id. */
	refundId?: string;
	/** Refunds: `amount` is the running total refunded so far, and the pipeline books what is new. */
	cumulative?: boolean;
	/** Major units, positive; a refund is stored negative. */
	amount: number;
	/** ISO 4217 code as the provider sent it. */
	currency: string;
	/** Proceeds after the provider's fee, when the provider says so. */
	netAmount?: number | null;
	/** Sandbox / test-mode payment: stored, never counted. */
	test: boolean;
	recurring: boolean;
	method: string;
	occurredAt?: string | null;
	visitorId?: string | null;
	sessionId?: string | null;
	utmSource?: string | null;
	utmMedium?: string | null;
	utmCampaign?: string | null;
	props: Record<string, unknown>;
}

export type ParsedDelivery =
	| { legs: PaymentLeg[]; label: string }
	/** Nothing to book (pending, expired, unrelated event). `label` is the logged event type suffix. */
	| { ignored: string };

export interface ProviderRow {
	id: string;
	site_id: string;
	config: Record<string, string>;
}

export interface DeliveryContext {
	db: Kysely<KlikapaDatabase>;
	rawBody: string;
	body: Record<string, unknown>;
	header: (name: string) => string;
	query: (name: string) => string | undefined;
	url: URL;
}

export type VerifyOutcome =
	| { ok: true }
	/** `label` suffixes the logged event type, `reason` is the logged machine code, `message` the HTTP error text. */
	| { ok: false; status: 400 | 401; label: string; reason: string; message: string };

/** What a provider must supply; the pipeline does the rest identically for all of them. */
export interface PaymentAdapter {
	/** payment_providers.provider, the rail, and the webhook_events prefix. */
	provider: string;
	/** Site the delivery names in its payload, or null. The `site_id` query parameter is tried after. */
	siteId(body: Record<string, unknown>): string | null;
	/**
	 * Provider-side ids of the sale a delivery without a site (a refund) is about,
	 * as idempotency keys' `<saleId>` part; the pipeline finds the site by the booked sale.
	 */
	saleIds?(body: Record<string, unknown>): string[];
	/** Override how the provider row is found (DOKU: by the X-PARTNER-ID header). */
	findProvider?(ctx: DeliveryContext): Promise<ProviderRow | null>;
	/** Authenticate the delivery with the site's own secret. Never throws. */
	verify(ctx: DeliveryContext, config: Record<string, string>): Promise<VerifyOutcome>;
	/**
	 * Turn the verified body into legs. Throw RetryableDeliveryError when the
	 * provider should retry; return `{ error }` for a body that can never be booked (422, or `status` 401 when the provider denies it).
	 */
	parse(
		ctx: DeliveryContext,
		config: Record<string, string>,
	): Promise<ParsedDelivery | { error: string; status?: 401 | 422 }>;
}

/** Something outside our control failed (provider API down); the provider's retry will succeed. */
export class RetryableDeliveryError extends Error {}
