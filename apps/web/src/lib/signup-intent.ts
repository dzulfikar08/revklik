/**
 * Signup intent that has to survive navigation: the affiliate `ref` code
 * (kept until an account is created, even across days) and the plan picked
 * on the pricing page (kept across the Google OAuth round trip).
 */
import { parsePlan } from "./legacy/billing";
import type { PlanTier } from "./legacy/billing";

const REF_KEY = "kp_ref";
const PLAN_KEY = "kp_signup_plan";

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

export const rememberRef = (ref: unknown): void => {
	if (typeof ref === "string" && REF_PATTERN.test(ref)) {
		write(REF_KEY, ref);
	}
};

export const storedRef = (): string | null => read(REF_KEY);

export const rememberSignupPlan = (plan: PlanTier | undefined): void => {
	write(PLAN_KEY, plan ?? null);
};

/** Read and clear the plan saved before an OAuth redirect. */
export const takeSignupPlan = (): PlanTier | undefined => {
	const plan = parsePlan(read(PLAN_KEY));
	write(PLAN_KEY, null);
	return plan;
};

/** Called once the account exists: the referral has been attributed. */
export const clearSignupIntent = (): void => {
	write(REF_KEY, null);
	write(PLAN_KEY, null);
};
