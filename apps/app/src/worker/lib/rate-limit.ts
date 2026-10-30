/**
 * Rate limiting for unauthenticated and token endpoints.
 *
 * Production uses Workers Rate Limiting bindings (`ratelimits` in wrangler.jsonc), which
 * are enforced per Cloudflare location across isolates. Where a binding is not configured
 * (local dev, tests, self-hosted installs that have not added them) the same limit is
 * enforced in memory, per isolate, so a limit always exists.
 */

/** Per-binding shape of the Workers Rate Limiting API. */
export interface RateLimitBinding {
	limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** The named limiters wrangler.jsonc declares; every one is optional at runtime. */
export interface RateLimitBindings {
	/** 120 requests / 60 s: tracker beacons, public dashboards and widgets. */
	RL_TRACK?: RateLimitBinding;
	/** 30 requests / 60 s: recordings and identify. */
	RL_TRACK_HEAVY?: RateLimitBinding;
	/** API tiers, requests / 60 s: micro 30, starter 120, growth 300, self-hosted 6000. */
	RL_API_30?: RateLimitBinding;
	RL_API_120?: RateLimitBinding;
	RL_API_300?: RateLimitBinding;
	RL_API_6000?: RateLimitBinding;
}

const WINDOW_MS = 60_000;
const CLEANUP_INTERVAL_MS = 120_000;

const buckets = new Map<string, { count: number; resetAt: number }>();
let lastCleanup = Date.now();

export interface LocalResult {
	allowed: boolean;
	remaining: number;
	resetAt: number;
}

/** In-memory fixed window: the fallback when no binding is configured. */
export function checkLocalLimit(key: string, limit: number, windowMs = WINDOW_MS): LocalResult {
	const now = Date.now();
	if (now - lastCleanup > CLEANUP_INTERVAL_MS) {
		for (const [k, v] of buckets) {
			if (now > v.resetAt) buckets.delete(k);
		}
		lastCleanup = now;
	}
	const entry = buckets.get(key);
	if (!entry || now > entry.resetAt) {
		const resetAt = now + windowMs;
		buckets.set(key, { count: 1, resetAt });
		return { allowed: true, remaining: limit - 1, resetAt };
	}
	if (entry.count >= limit) return { allowed: false, remaining: 0, resetAt: entry.resetAt };
	entry.count++;
	return { allowed: true, remaining: limit - entry.count, resetAt: entry.resetAt };
}

/**
 * True when `key` may proceed. `limit` is the per-minute cap the binding was declared with;
 * it is only used by the in-memory fallback. A failing binding lets the request through:
 * an outage of the limiter must not become an outage of ingest.
 */
export async function allowRequest(
	binding: RateLimitBinding | undefined,
	key: string,
	limit: number,
): Promise<boolean> {
	if (!binding) return checkLocalLimit(key, limit).allowed;
	try {
		return (await binding.limit({ key })).success;
	} catch (err) {
		console.error("[rate-limit] binding failed, allowing:", err);
		return true;
	}
}

/** The API limiter binding that matches `limit` requests per minute. */
export function apiLimiterFor(
	env: RateLimitBindings | undefined,
	limit: number,
): RateLimitBinding | undefined {
	switch (limit) {
		case 30:
			return env?.RL_API_30;
		case 120:
			return env?.RL_API_120;
		case 300:
			return env?.RL_API_300;
		case 6000:
			return env?.RL_API_6000;
		default:
			return undefined;
	}
}
