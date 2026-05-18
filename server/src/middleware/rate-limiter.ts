import { createMiddleware } from "hono/factory";
import type { KlikapaDatabase } from "shared";
import type { Kysely } from "kysely";
import type { PublicApiEnv } from "./public-auth";
import { getApiRateLimit } from "../lib/plans";

// In-memory per-key rate limiting (per-isolate, resets on Worker recycle)
const rlMap = new Map<string, { count: number; resetAt: number; limit: number }>();
let lastCleanup = Date.now();

function checkRateLimit(keyPrefix: string, limit: number, windowMs: number): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();

  // Periodic cleanup
  if (now - lastCleanup > 120_000) {
    for (const [k, v] of rlMap) {
      if (now > v.resetAt) rlMap.delete(k);
    }
    lastCleanup = now;
  }

  const entry = rlMap.get(keyPrefix);
  if (!entry || now > entry.resetAt) {
    const resetAt = now + windowMs;
    rlMap.set(keyPrefix, { count: 1, resetAt, limit });
    return { allowed: true, remaining: limit - 1, resetAt };
  }

  if (entry.count >= entry.limit) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count++;
  return { allowed: true, remaining: entry.limit - entry.count, resetAt: entry.resetAt };
}

export const rateLimiterMiddleware = createMiddleware<PublicApiEnv>(async (c, next) => {
  const db = c.get("db");
  const userId = c.get("userId");
  if (!db || !userId) return c.json({ error: "Database unavailable", success: false }, 503);

  // Get user's plan for rate limit tier
  let plan = "micro";
  try {
    const sub = await db
      .selectFrom("subscriptions")
      .select(["plan"])
      .where("user_id", "=", userId)
      .executeTakeFirst();
    if (sub?.plan) plan = sub.plan;
  } catch { /* default to micro */ }

  const limit = getApiRateLimit(plan);
  const authHeader = c.req.header("Authorization") ?? "";
  const tokenPrefix = authHeader.slice(7, 14); // Use first 7 chars of token as key

  const result = checkRateLimit(tokenPrefix, limit, 60_000);

  c.header("X-RateLimit-Limit", String(limit));
  c.header("X-RateLimit-Remaining", String(result.remaining));
  c.header("X-RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));

  if (!result.allowed) {
    const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
    c.header("Retry-After", String(retryAfter));
    return c.json({ error: "Rate limit exceeded", success: false }, 429);
  }

  await next();
});
