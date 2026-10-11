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
