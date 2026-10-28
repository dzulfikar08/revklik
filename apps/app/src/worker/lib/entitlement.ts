/** Ingest keeps flowing this long after current_period_end so a late renewal loses no data. */
export const INGEST_GRACE_MS = 14 * 86_400_000;

// "pending" only exists on rows demoted by the pre-DEV-29 QRIS checkout; those
// users were still paying customers, so the status is honoured until period end.
const LIVE_STATUSES = new Set(["active", "trialing", "past_due", "pending"]);

export interface SubscriptionState {
	plan: string;
	status: string;
	current_period_end: string | null;
}

/**
 * SELF_HOSTED=1 (or "true") turns the instance into a fully unlocked install:
 * every account is entitled to everything, forever, and RevKlik's own billing
 * (plans, checkout, trials, referral payouts) is switched off. Unset = hosted.
 */
export function isSelfHosted(env: { SELF_HOSTED?: string } | undefined): boolean {
	const raw = env?.SELF_HOSTED?.trim().toLowerCase();
	return raw === "1" || raw === "true";
}

/** What every account holds on a self-hosted instance: top tier, active, no period end. */
export const SELF_HOSTED_ENTITLEMENT: SubscriptionState = {
	plan: "growth",
	status: "active",
	current_period_end: null,
};

/**
 * The subscription an entitlement check must evaluate: the stored row when
 * hosted, the unlimited self-hosted entitlement otherwise (even without a row).
 */
export function effectiveSubscription<T extends SubscriptionState>(
	sub: T | null | undefined,
	selfHosted: boolean,
): T | SubscriptionState | null | undefined {
	return selfHosted ? SELF_HOSTED_ENTITLEMENT : sub;
}

function periodEndMs(sub: SubscriptionState): number | null {
	if (!sub.current_period_end) return null;
	const ms = new Date(sub.current_period_end).getTime();
	return Number.isFinite(ms) ? ms : null;
}

/** Paid or trialing and inside the current period: full dashboard access. */
export function isSubscriptionActive(sub: SubscriptionState, now = Date.now()): boolean {
	if (!LIVE_STATUSES.has(sub.status)) return false;
	const end = periodEndMs(sub);
	return end === null || end >= now;
}

/** Ingest is accepted while active and for INGEST_GRACE_MS after the period ends. */
export function isIngestAllowed(sub: SubscriptionState, now = Date.now()): boolean {
	if (isSubscriptionActive(sub, now)) return true;
	const end = periodEndMs(sub);
	return end !== null && now <= end + INGEST_GRACE_MS;
}

export function isTrialExpired(sub: SubscriptionState, now = Date.now()): boolean {
	const end = periodEndMs(sub);
	return sub.status === "trialing" && end !== null && end < now;
}
