/**
 * Legacy klikapa billing endpoints (GET/POST /billing/*) on the production
 * revklik Worker. Deliberately isolated from better-auth's Polar client:
 * this module talks to the klikapa billing routes only.
 */
import { legacyFetch, legacyFetchEnvelope } from "./api";

export type PlanTier = "micro" | "starter" | "growth";

export const PLAN_TIERS: readonly PlanTier[] = ["micro", "starter", "growth"];

/** Narrow an untrusted value (search param, storage) to a plan tier. */
export const parsePlan = (value: unknown): PlanTier | undefined =>
	PLAN_TIERS.find((tier) => tier === value);

/** Display name for a tier; unknown values pass through capitalised. */
export const planLabel = (plan: string): string =>
	plan ? `${plan.charAt(0).toUpperCase()}${plan.slice(1)}` : plan;

/** `?checkout=` values the payment providers send the browser back with. */
export type CheckoutResult = "success" | "pakasir_success";

export const parseCheckoutResult = (value: unknown): CheckoutResult | undefined =>
	value === "success" || value === "pakasir_success" ? value : undefined;

/** Pakasir QRIS prices in IDR; must match apps/app/src/worker/lib/pakasir.ts. */
export const IDR_PRICE: Record<PlanTier, number> = {
	micro: 16_000,
	starter: 64_000,
	growth: 192_000,
};

/** Card prices in USD; must match apps/app/src/worker/lib/plans.ts. */
export const USD_PRICE: Record<PlanTier, number> = {
	micro: 1,
	starter: 4,
	growth: 12,
};

/** Days of tracking after a trial or subscription lapses. */
export const GRACE_DAYS = 14;

const DAY_MS = 86_400_000;

/** Whole days until `iso`, rounded up; 0 once it has passed. */
export const daysUntil = (iso: string | null | undefined, now = Date.now()): number => {
	if (!iso) {
		return 0;
	}
	const diff = new Date(iso).getTime() - now;
	return Number.isFinite(diff) && diff > 0 ? Math.ceil(diff / DAY_MS) : 0;
};

/**
 * Grandfathered and self-hosted accounts carry a period end in the year 9999
 * ("never"). Anything this far out is open-ended, not a date to show.
 */
const OPEN_ENDED_FROM_YEAR = 3000;

export const isOpenEnded = (iso: string | null | undefined): boolean => {
	if (!iso) {
		return false;
	}
	const year = new Date(iso).getUTCFullYear();
	return Number.isFinite(year) && year >= OPEN_ENDED_FROM_YEAR;
};

/** How full a limit is: "over" past it, "full" at it, "near" from 90%. */
export type UsageLevel = "ok" | "near" | "full" | "over";

const NEAR_LIMIT_RATIO = 0.9;

export const usageLevel = (used: number, limit: number): UsageLevel => {
	if (!(limit > 0)) {
		return "ok";
	}
	if (used > limit) {
		return "over";
	}
	if (used === limit) {
		return "full";
	}
	return used / limit >= NEAR_LIMIT_RATIO ? "near" : "ok";
};

export type SubscriptionStatus = "active" | "canceled" | "past_due" | "trialing";

export interface BillingUsage {
	events: { used: number; limit: number };
	sites: { used: number; limit: number };
}

export interface PendingOrder {
	order_id: string;
	plan: string;
	amount: number;
	checkout_url: string;
	created_at: string;
}

export interface BillingSubscription {
	id: string;
	user_id: string;
	plan: PlanTier;
	/** Known statuses above; the API may add more, so treat unknowns as inactive. */
	status: SubscriptionStatus | (string & {});
	current_period_start: string;
	current_period_end: string;
	cancel_at_period_end: boolean;
	polar_subscription_id: string | null;
	polar_customer_id: string | null;
	usage?: BillingUsage;
	trial_days_remaining?: number | null;
	trial_expired?: boolean;
	/** Unpaid QRIS order, so the "finish your payment" banner survives reloads. */
	pending_order?: PendingOrder | null;
}

/** Derived billing state shared by the billing view, banner and lock. */
export interface SubscriptionState {
	trialing: boolean;
	trialEnded: boolean;
	trialDaysLeft: number;
	/** Paid and inside the current period. */
	paidActive: boolean;
	/** Days of grace tracking left after a lapse; 0 when not lapsed or used up. */
	graceDaysLeft: number;
}

export const subscriptionState = (
	sub: BillingSubscription,
	now = Date.now(),
): SubscriptionState => {
	const periodOver = new Date(sub.current_period_end).getTime() <= now;
	const trialing = sub.status === "trialing";
	const trialEnded = trialing && (Boolean(sub.trial_expired) || periodOver);
	const trialDaysLeft = trialing
		? (sub.trial_days_remaining ?? daysUntil(sub.current_period_end, now))
		: 0;
	const paidActive = sub.status === "active" && !periodOver;
	const lapsed = (trialing && trialEnded) || (!trialing && !paidActive);
	const graceEnd = new Date(new Date(sub.current_period_end).getTime() + GRACE_DAYS * DAY_MS);
	return {
		graceDaysLeft: lapsed ? daysUntil(graceEnd.toISOString(), now) : 0,
		paidActive,
		trialDaysLeft: trialEnded ? 0 : trialDaysLeft,
		trialEnded,
		trialing,
	};
};

export interface BillingPlan {
	tier: PlanTier;
	name: string;
	price: number;
	/** IDR price when the API sends one; IDR_PRICE otherwise. */
	price_idr?: number;
	events_per_month: number;
	sites: number;
	features: string[];
	checkout_url: string | null;
}

export interface BillingAlerts {
	weekly_report: boolean;
	milestone_alerts: boolean;
	conversion_alerts: boolean;
}

export const fetchSubscription = (): Promise<BillingSubscription> =>
	legacyFetch("/billing/subscription");

export interface PlansResponse {
	plans: BillingPlan[];
	/** QRIS only works with Indonesian payment apps; the API sets this by visitor country. */
	qris_available: boolean;
}

/**
 * GET /billing/plans returns `{ data: BillingPlan[], qris_available }` with
 * the flag next to `data`; a `{ data: { plans, qris_available } }` shape is
 * accepted too.
 */
export const fetchPlans = async (): Promise<PlansResponse> => {
	const json = await legacyFetchEnvelope<BillingPlan[] | Partial<PlansResponse>>("/billing/plans");
	const { data } = json;
	if (Array.isArray(data)) {
		return { plans: data, qris_available: json.qris_available === true };
	}
	return {
		plans: data?.plans ?? [],
		qris_available: data?.qris_available ?? json.qris_available === true,
	};
};

/** Polar card checkout: returns the hosted checkout URL to redirect to. */
export const createCheckout = (plan: PlanTier): Promise<{ url: string }> =>
	legacyFetch("/billing/checkout", {
		body: JSON.stringify({ plan }),
		method: "POST",
	});

/** Pakasir QRIS checkout: returns the payment-page URL plus order details. */
export const createPakasirCheckout = (
	plan: PlanTier,
): Promise<{ url: string; order_id: string; amount: number; plan: string }> =>
	legacyFetch("/billing/checkout/pakasir", {
		body: JSON.stringify({ plan }),
		method: "POST",
	});

/**
 * Safety net after the user returns from the QRIS page: re-checks the
 * pending Pakasir order with the transaction API in case the webhook lagged.
 */
export const verifyPakasirPayment = (): Promise<{
	status: "active" | "pending" | "no_pending_order";
	plan?: string;
}> => legacyFetch("/billing/pakasir/verify", { method: "POST" });

export const cancelSubscription = (): Promise<void> =>
	legacyFetch("/billing/cancel", { method: "POST" });

export const fetchBillingAlerts = (): Promise<BillingAlerts> => legacyFetch("/billing/alerts");

export const updateBillingAlerts = (prefs: BillingAlerts): Promise<BillingAlerts> =>
	legacyFetch("/billing/alerts", {
		body: JSON.stringify(prefs),
		method: "POST",
	});
