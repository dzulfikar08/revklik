import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { generateId } from "../utils";
import { recordReferralCommission } from "./affiliates";
import { convertAmount, type FxRates, usdRates } from "./fx";
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
//   RVK-{userId8}-{base36 timestamp}{4 random base36}
// The random tail keeps two checkouts in the same millisecond (double click)
// from colliding on the pakasir_orders primary key.
export function newPakasirOrderId(userId: string, now = Date.now()): string {
	const tail =
		crypto.getRandomValues(new Uint32Array(1))[0]?.toString(36).slice(-4).padStart(4, "0") ??
		"0000";
	return `RVK-${userId.slice(0, 8)}-${now.toString(36).toUpperCase()}${tail.toUpperCase()}`;
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

/**
 * Order by id. Orders created before pakasir_orders existed only live on
 * subscriptions.pakasir_order_id (status 'pending'); those are adopted into
 * the table on first sight so the normal claim flow applies.
 */
export async function findPakasirOrder(
	db: Kysely<KlikapaDatabase>,
	orderId: string,
): Promise<PakasirOrderRow | undefined> {
	const row = await db
		.selectFrom("pakasir_orders")
		.selectAll()
		.where("order_id", "=", orderId)
		.executeTakeFirst();
	if (row) return row;
	const legacy = await db
		.selectFrom("subscriptions")
		.select(["user_id", "plan", "updated_at"])
		.where("pakasir_order_id", "=", orderId)
		.where("status", "=", "pending")
		.executeTakeFirst();
	const amount = legacy ? PAKASIR_PRICES[legacy.plan as PlanTier] : undefined;
	if (!legacy || !amount) return undefined;
	await db
		.insertInto("pakasir_orders")
		.values({
			order_id: orderId,
			user_id: legacy.user_id,
			plan: legacy.plan,
			amount,
			checkout_url: `https://app.pakasir.com/pay/${PAKASIR_PROJECT}/${amount}?order_id=${orderId}&qris_only=1`,
			status: "pending",
			created_at: legacy.updated_at,
			processed_at: null,
		})
		.onConflict((oc) => oc.column("order_id").doNothing())
		.execute();
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
	fxRates?: FxRates;
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

	// Renewing the same plan stacks onto the paid end; a plan change starts a
	// fresh 30-day period on the new plan from now.
	const existing = await db
		.selectFrom("subscriptions")
		.select(["status", "plan", "current_period_end"])
		.where("user_id", "=", userId)
		.executeTakeFirst();
	const existingEnd = existing?.current_period_end
		? new Date(existing.current_period_end).getTime()
		: 0;
	const stacks = existing?.status === "active" && existing.plan === plan && existingEnd > nowMs;
	const baseMs = stacks ? existingEnd : nowMs;
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
			pakasir_paid_until: periodEnd,
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
				pakasir_paid_until: periodEnd,
				updated_at: now,
			}),
		)
		.execute();

	await recordReferralCommission(
		db,
		userId,
		`pakasir:${orderId}`,
		convertAmount(amount, "IDR", "USD", input.fxRates ?? usdRates()),
	);

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
