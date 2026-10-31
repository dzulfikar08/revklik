/**
 * Signup intent that has to survive navigation: the affiliate `ref` code
 * (kept until an account is created, even across days), the plan picked
 * on the pricing page (kept across the Google OAuth round trip) and the
 * tracker visitor id (`rk_vid`) the marketing site handed over, which ties
 * the new account's signup conversion to the visit that produced it.
 */
import { parsePlan } from "./legacy/billing";
import type { PlanTier } from "./legacy/billing";

const REF_KEY = "kp_ref";
const PLAN_KEY = "kp_signup_plan";
const VISITOR_KEY = "kp_rk_vid";
const NEXT_KEY = "kp_signin_next";

/** Tracker ids are `crypto.randomUUID()` values. */
const TRACKER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** Referral codes are short slugs; anything else is ignored. */
const REF_PATTERN = /^[\w-]{1,64}$/u;

const read = (key: string): string | null => {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
};

const write = (key: string, value: string | null): void => {
	try {
		if (value === null) {
			localStorage.removeItem(key);
		} else {
			localStorage.setItem(key, value);
		}
	} catch {
		// Storage blocked: the intent only lives for this page view.
	}
};

/** A referral code if `value` looks like one, else undefined. */
export const parseRef = (value: unknown): string | undefined =>
	typeof value === "string" && REF_PATTERN.test(value) ? value : undefined;

export const rememberRef = (ref: unknown): void => {
	const valid = parseRef(ref);
	if (valid) {
		write(REF_KEY, valid);
	}
};

/** The saved referral code; re-validated in case storage was edited. */
export const storedRef = (): string | null => parseRef(read(REF_KEY)) ?? null;

/** `?ref=` from the URL wins over the saved one; both are validated. */
export const signupRef = (fromUrl: unknown): string | null => parseRef(fromUrl) ?? storedRef();

/** A tracker visitor/session id if `value` is UUID-shaped, else undefined. */
export const parseTrackerId = (value: unknown): string | undefined =>
	typeof value === "string" && TRACKER_ID_PATTERN.test(value) ? value.toLowerCase() : undefined;

export const rememberVisitorId = (visitorId: unknown): void => {
	const valid = parseTrackerId(visitorId);
	if (valid) {
		write(VISITOR_KEY, valid);
	}
};

/** `?rk_vid=` from the URL wins over the saved one; both are validated. */
export const signupVisitorId = (fromUrl: unknown): string | null =>
	parseTrackerId(fromUrl) ?? parseTrackerId(read(VISITOR_KEY)) ?? null;

export const rememberSignupPlan = (plan: PlanTier | undefined): void => {
	write(PLAN_KEY, plan ?? null);
};

/** Read and clear the plan saved before an OAuth redirect. */
export const takeSignupPlan = (): PlanTier | undefined => {
	const plan = parsePlan(read(PLAN_KEY));
	write(PLAN_KEY, null);
	return plan;
};

/** Where the user was heading before "Continue with Google"; unvalidated, callers run it through parseNext. */
export const rememberSignInNext = (next: string | undefined): void => {
	write(NEXT_KEY, next ?? null);
};

/** Read and clear the saved destination (raw: the caller validates it). */
export const takeSignInNext = (): string | null => {
	const next = read(NEXT_KEY);
	write(NEXT_KEY, null);
	return next;
};

/** Called once the account exists: the referral has been attributed. */
export const clearSignupIntent = (): void => {
	write(REF_KEY, null);
	write(PLAN_KEY, null);
	write(VISITOR_KEY, null);
};
