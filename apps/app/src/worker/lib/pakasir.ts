import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { sql } from "kysely";
import { generateId } from "../utils";
import type { PlanTier } from "./plans";

// Pakasir (QRIS payment links) — docs: https://pakasir.com/p/docs
// Checkout URLs: https://app.pakasir.com/pay/{project}/{amount}?order_id=...
// Webhook: POST with { amount, order_id, project, status, payment_method, completed_at }
export const PAKASIR_PROJECT = "revklik";
export const PAKASIR_API = "https://app.pakasir.com/api";

// IDR prices — must match the landing page and the paywall exactly.
export const PAKASIR_PRICES: Record<PlanTier, number> = {
	micro: 16_000,
	starter: 64_000,
	growth: 192_000,
};

// order_id format stamped by POST /billing/checkout/pakasir:
//   RVK-{userId8}-{base36 timestamp}
export function newPakasirOrderId(userId: string, now = Date.now()): string {
	return `RVK-${userId.slice(0, 8)}-${now.toString(36).toUpperCase()}`;
}

export function pakasirCheckoutUrl(amount: number, orderId: string, successUrl: string): string {
	return `https://app.pakasir.com/pay/${PAKASIR_PROJECT}/${amount}?order_id=${orderId}&redirect=${encodeURIComponent(successUrl)}&qris_only=1`;
}

export type PakasirOrderRow = KlikapaDatabase["pakasir_orders"];

/** Record a pending QRIS order. The subscription row is never touched until payment. */
export async function createPakasirOrder(
	db: Kysely<KlikapaDatabase>,
	order: Omit<PakasirOrderRow, "status" | "processed_at">,
): Promise<void> {
	await db
		.insertInto("pakasir_orders")
		.values({ ...order, status: "pending", processed_at: null })
		.execute();
}

export function findPakasirOrder(
	db: Kysely<KlikapaDatabase>,
	orderId: string,
): Promise<PakasirOrderRow | undefined> {
	return db
		.selectFrom("pakasir_orders")
		.selectAll()
		.where("order_id", "=", orderId)
		.executeTakeFirst();
}

export function latestPendingPakasirOrder(
	db: Kysely<KlikapaDatabase>,
	userId: string,
	sinceIso?: string,
): Promise<PakasirOrderRow | undefined> {
	let q = db
		.selectFrom("pakasir_orders")
		.selectAll()
		.where("user_id", "=", userId)
		.where("status", "=", "pending");
	if (sinceIso) q = q.where("created_at", ">=", sinceIso);
	return q.orderBy("created_at", "desc").limit(1).executeTakeFirst();
}

interface PakasirPaymentInput {
	userId: string;
	plan: PlanTier;
	orderId: string;
	amount: number;
	paymentMethod?: string | null;
	completedAt?: string | null;
}

export interface ActivationResult {
	activated: boolean;
	alreadyProcessed: boolean;
}

const PERIOD_MS = 30 * 86_400_000;

// Activate a paid order exactly once: the pending -> completed flip on
// pakasir_orders is the idempotency gate, so a replayed or re-verified order
// can never extend the period a second time.
export async function activatePakasirPayment(
	db: Kysely<KlikapaDatabase>,
	input: PakasirPaymentInput,
): Promise<ActivationResult> {
	const { userId, plan, orderId, amount } = input;
	const nowMs = Date.now();
	const now = new Date(nowMs).toISOString();

	const claimed = await db
		.updateTable("pakasir_orders")
		.set({ status: "completed", processed_at: now })
		.where("order_id", "=", orderId)
		.where("status", "=", "pending")
		.returning("order_id")
		.execute();
	if (claimed.length === 0) return { activated: false, alreadyProcessed: true };

	// Renewing an active paid period stacks onto its end instead of losing days.
	const existing = await db
		.selectFrom("subscriptions")
		.select(["status", "current_period_end"])
		.where("user_id", "=", userId)
		.executeTakeFirst();
	const existingEnd = existing?.current_period_end
		? new Date(existing.current_period_end).getTime()
		: 0;
	const baseMs = existing?.status === "active" && existingEnd > nowMs ? existingEnd : nowMs;
	const periodStart = new Date(baseMs).toISOString();
	const periodEnd = new Date(baseMs + PERIOD_MS).toISOString();

	await db
		.insertInto("subscriptions")
		.values({
			id: generateId(),
			user_id: userId,
			plan,
			status: "active",
			current_period_start: periodStart,
			current_period_end: periodEnd,
			cancel_at_period_end: 0,
			polar_subscription_id: null,
			polar_customer_id: null,
			pakasir_order_id: orderId,
			created_at: now,
			updated_at: now,
		})
		.onConflict((oc) =>
			oc.column("user_id").doUpdateSet({
				plan,
				status: "active",
				current_period_start: periodStart,
				current_period_end: periodEnd,
				cancel_at_period_end: 0,
				pakasir_order_id: orderId,
				updated_at: now,
			}),
		)
		.execute();

	// Revenue attribution — attach to the user's first site if they have one.
	// visitor_id embeds the order_id, which doubles as the idempotency key.
	const visitorId = `pakasir_${orderId.replace(/[^a-zA-Z0-9]/g, "_")}`;
	const siteId = await db
		.selectFrom("sites")
		.select(["id"])
		.where("user_id", "=", userId)
		.orderBy("created_at")
		.limit(1)
		.executeTakeFirst()
		.then((r) => r?.id);
	if (!siteId) return { activated: true, alreadyProcessed: false };

	const seen = await db
		.selectFrom("events")
		.select(["id"])
		.where("site_id", "in", db.selectFrom("sites").select("id").where("user_id", "=", userId))
		.where("visitor_id", "=", visitorId)
		.where("event_type", "=", "conversion")
		.where("name", "=", "subscription_payment")
		.executeTakeFirst();
	if (seen) return { activated: true, alreadyProcessed: true };

	const ts = input.completedAt || now;
	await db
		.insertInto("events")
		.values({
			id: generateId(),
			site_id: siteId,
			session_id: generateId(),
			visitor_id: visitorId,
			timestamp: ts,
			event_type: "conversion",
			name: "subscription_payment",
			path: "/billing/pakasir",
			hostname: null,
			referrer: null,
			utm_source: null,
			utm_medium: null,
			utm_campaign: null,
			utm_term: null,
			utm_content: null,
			country: "ID",
			region: null,
			city: null,
			device_type: null,
			browser: null,
			os: null,
			revenue: amount,
			payment_provider: "pakasir",
			payment_method: input.paymentMethod || null,
			currency: "IDR",
			props: JSON.stringify({
				plan,
				order_id: orderId,
				payment_method: input.paymentMethod || null,
				source: "pakasir_webhook",
				amount_idr: amount,
			}),
			fingerprint: null,
		})
		.execute();

	// visitor_profiles row is only written when it already exists — the visitor
	// is synthetic (no real sessions), so we don't create profile noise for
	// sites that have never seen this visitor.
	await db
		.insertInto("visitor_profiles")
		.values({
			id: generateId(),
			site_id: siteId,
			visitor_id: visitorId,
			first_seen: ts,
			last_seen: ts,
			country: "ID",
			region: null,
			city: null,
			device_type: null,
			browser: null,
			os: null,
			total_sessions: 0,
			total_pageviews: 0,
			total_revenue: amount,
			fingerprint: null,
		})
		.onConflict((oc) =>
			oc.columns(["site_id", "visitor_id"]).doUpdateSet({
				last_seen: ts,
				total_revenue: sql`total_revenue + ${amount}`,
			}),
		)
		.execute();

	return { activated: true, alreadyProcessed: false };
}

interface PakasirTransaction {
	amount: number;
	order_id: string;
	project: string;
	status: string;
	payment_method?: string | null;
	completed_at?: string | null;
}

// Server-side verification via the transaction detail API. Returns null when
// PAKASIR_API_KEY is unset (local dev) — callers treat that as "unverified".
export async function verifyWithPakasir(
	apiKey: string,
	orderId: string,
	amount: number,
): Promise<PakasirTransaction | null> {
	if (!apiKey) return null;
	const url = `${PAKASIR_API}/transactiondetail?project=${PAKASIR_PROJECT}&amount=${amount}&order_id=${encodeURIComponent(orderId)}&api_key=${encodeURIComponent(apiKey)}`;
	const res = await fetch(url);
	if (!res.ok) return null;
	const json = (await res.json()) as { transaction?: PakasirTransaction };
	return json.transaction ?? null;
}
