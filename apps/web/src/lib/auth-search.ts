/**
 * Search params for /login and /register, and where to go once signed in.
 * Kept free of React so route guards and tests can use it directly.
 */
import { parsePlan } from "./legacy/billing";
import type { PlanTier } from "./legacy/billing";
import { parseRef, parseTrackerId } from "./signup-intent";

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign"] as const;

export interface AuthSearch {
	plan?: PlanTier;
	ref?: string;
	/** Tracker visitor id handed over by the marketing site (journey link). */
	rk_vid?: string;
	/** Tracker session id handed over by the marketing site. */
	rk_sid?: string;
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

/** Keep a known plan, a valid ref, a safe `next`, journey ids and UTM tags; drop the rest. */
export const validateAuthSearch = (search: Record<string, unknown>): AuthSearch => {
	const out: AuthSearch = {};
	const plan = parsePlan(search.plan);
	if (plan) out.plan = plan;
	const ref = parseRef(search.ref);
	if (ref) out.ref = ref;
	const visitorId = parseTrackerId(search.rk_vid);
	if (visitorId) out.rk_vid = visitorId;
	const sessionId = parseTrackerId(search.rk_sid);
	if (sessionId) out.rk_sid = sessionId;
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
 * Google OAuth start URL. The worker carries `ref`, `plan` and the journey
 * visitor id (`rk_vid`) through the OAuth state to the new account; all are
 * validated before they're sent.
 */
export const googleAuthUrl = (
	apiBase: string,
	ref: unknown,
	plan: unknown,
	visitorId?: unknown,
): string => {
	const query = new URLSearchParams();
	const validRef = parseRef(ref);
	const validPlan = parsePlan(plan);
	const validVisitor = parseTrackerId(visitorId);
	if (validRef) query.set("ref", validRef);
	if (validPlan) query.set("plan", validPlan);
	if (validVisitor) query.set("rk_vid", validVisitor);
	return `${apiBase}/auth/google${query.size > 0 ? `?${query}` : ""}`;
};

/** A picked plan goes to billing, then a saved `next`, else the sites list. */
export const afterAuthTarget = (search: AuthSearch): AfterAuthTarget => {
	if (search.plan) return { search: { plan: search.plan }, to: "/analytics/billing" };
	if (search.next) return { href: search.next };
	return { to: "/analytics" };
};

/**
 * The same destination as a path for a full page load. /login and /register
 * run the tracker (see lib/tracker.ts); leaving them by document navigation,
 * not router navigation, is what keeps it off the authenticated pages.
 */
export const afterAuthPath = (search: AuthSearch): string => {
	if (search.plan) return `/analytics/billing?plan=${search.plan}`;
	return search.next ?? "/analytics";
};
