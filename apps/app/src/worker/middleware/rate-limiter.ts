import { createMiddleware } from "hono/factory";
import { isSelfHosted } from "../lib/entitlement";
import { getApiRateLimit } from "../lib/plans";
import { allowRequest, apiLimiterFor, checkLocalLimit } from "../lib/rate-limit";
import type { PublicApiEnv } from "./public-auth";

const WINDOW_MS = 60_000;

export const rateLimiterMiddleware = createMiddleware<PublicApiEnv>(async (c, next) => {
	const db = c.get("db");
	const userId = c.get("userId");
	if (!db || !userId) return c.json({ error: "Database unavailable", success: false }, 503);

	// Get user's plan for rate limit tier
	let plan = c.get("plan") ?? "micro";
	if (c.get("plan") === undefined) {
		try {
			const sub = await db
				.selectFrom("subscriptions")
				.select(["plan"])
				.where("user_id", "=", userId)
				.executeTakeFirst();
			if (sub?.plan) plan = sub.plan;
		} catch {
			/* default to micro */
		}
	}

	const limit = getApiRateLimit(plan, isSelfHosted(c.env));
	// One bucket per token, not per token prefix: a prefix is shared by thousands of tokens.
	const key = `api:${c.get("tokenId")}`;
	c.header("X-RateLimit-Limit", String(limit));

	const binding = apiLimiterFor(c.env, limit);
	if (binding) {
		if (!(await allowRequest(binding, key, limit))) {
			c.header("Retry-After", String(WINDOW_MS / 1000));
			return c.json({ error: "Rate limit exceeded", success: false }, 429);
		}
		await next();
		return;
	}

	const result = checkLocalLimit(key, limit, WINDOW_MS);
	c.header("X-RateLimit-Remaining", String(result.remaining));
	c.header("X-RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));
	if (!result.allowed) {
		c.header("Retry-After", String(Math.ceil((result.resetAt - Date.now()) / 1000)));
		return c.json({ error: "Rate limit exceeded", success: false }, 429);
	}

	await next();
});
