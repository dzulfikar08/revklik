import { normalizeCurrency } from "./fx";

/** Largest single revenue value accepted from a client. */
export const MAX_REVENUE = 1e9;
const FUTURE_SKEW_MS = 5 * 60_000;
const MAX_CLIENT_AGE_MS = 48 * 3_600_000;

/** Finite, non-negative, capped revenue; anything else is dropped (null). */
export function sanitizeRevenue(raw: unknown): number | null {
	if (raw === null || raw === undefined || raw === "") return null;
	const n = typeof raw === "number" ? raw : Number(raw);
	if (!Number.isFinite(n) || n < 0 || n > MAX_REVENUE) return null;
	return n;
}

/**
 * Client event time, trusted only inside [now - maxAgeMs, now + 5 min]; an
 * unparseable, future, or too-old value falls back to server time.
 */
export function resolveEventTimestamp(
	raw: unknown,
	nowMs = Date.now(),
	maxAgeMs = MAX_CLIENT_AGE_MS,
): string {
	if (typeof raw !== "string" && typeof raw !== "number") return new Date(nowMs).toISOString();
	const ms = new Date(raw).getTime();
	if (!Number.isFinite(ms) || ms > nowMs + FUTURE_SKEW_MS || ms < nowMs - maxAgeMs) {
		return new Date(nowMs).toISOString();
	}
	return new Date(ms).toISOString();
}

/** Revenue currency for a tracked event: explicit field, then props.currency, then the site's. */
export function eventCurrency(
	explicit: unknown,
	props: unknown,
	siteCurrency: string | null | undefined,
): string {
	const fromProps =
		props && typeof props === "object" ? (props as Record<string, unknown>).currency : undefined;
	return normalizeCurrency(explicit) ?? normalizeCurrency(fromProps) ?? siteCurrency ?? "USD";
}
