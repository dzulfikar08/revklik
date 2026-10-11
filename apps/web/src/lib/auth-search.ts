/**
 * Search params for /login and /register, and where to go once signed in.
 * Kept free of React so route guards and tests can use it directly.
 */
import { parsePlan } from "./legacy/billing";
import type { PlanTier } from "./legacy/billing";
import { parseRef } from "./signup-intent";

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign"] as const;

export interface AuthSearch {
	plan?: PlanTier;
	ref?: string;
	/** In-app path to return to after sign-in (e.g. billing after a checkout). */
	next?: string;
	utm_source?: string;
	utm_medium?: string;
	utm_campaign?: string;
}

/**
 * Only same-app dashboard paths are accepted as `next`, so the param can't
 * be used as an open redirect ("//evil.com", "https://…").
 */
export const parseNext = (value: unknown): string | undefined =>
	typeof value === "string" && /^\/analytics(?:[/?]|$)/u.test(value) ? value : undefined;

/** Keep a known plan, a valid ref, a safe `next` and UTM tags; drop the rest. */
export const validateAuthSearch = (search: Record<string, unknown>): AuthSearch => {
	const out: AuthSearch = {};
	const plan = parsePlan(search.plan);
	if (plan) out.plan = plan;
	const ref = parseRef(search.ref);
	if (ref) out.ref = ref;
	const next = parseNext(search.next);
	if (next) out.next = next;
	for (const key of UTM_KEYS) {
		const value = search[key];
		if (typeof value === "string" && value) out[key] = value;
	}
	return out;
};

export type AfterAuthTarget =
	| { href: string }
	| { to: "/analytics/billing"; search: { plan: PlanTier } }
	| { to: "/analytics" };

/**
 * Google OAuth start URL. The worker carries `ref` and `plan` through the
 * OAuth state to the new account; both are validated before they're sent.
 */
export const googleAuthUrl = (apiBase: string, ref: unknown, plan: unknown): string => {
	const query = new URLSearchParams();
	const validRef = parseRef(ref);
	const validPlan = parsePlan(plan);
	if (validRef) query.set("ref", validRef);
	if (validPlan) query.set("plan", validPlan);
	return `${apiBase}/auth/google${query.size > 0 ? `?${query}` : ""}`;
};

/** A picked plan goes to billing, then a saved `next`, else the sites list. */
export const afterAuthTarget = (search: AuthSearch): AfterAuthTarget => {
	if (search.plan) return { search: { plan: search.plan }, to: "/analytics/billing" };
	if (search.next) return { href: search.next };
	return { to: "/analytics" };
};
