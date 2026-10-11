import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import type { Env } from "../types";
import { isSubscriptionActive } from "./entitlement";
import { PLANS, requirePlan } from "./plans";

type GateEnv = Env;

export type GatedPlan = "starter" | "growth";

/** 403 body shared by every plan-gated route (frontend contract). */
export function planRequiredBody(required: GatedPlan, current: string) {
	return {
		success: false as const,
		error: "plan_required" as const,
		required_plan: required,
		current_plan: current,
	};
}

/** Returns a 403 response when the caller's plan is below `required`, else null. */
export async function checkPlan(
	c: Context<GateEnv>,
	required: GatedPlan,
): Promise<Response | null> {
	const check = await requirePlan(c.get("db"), c.get("userId"), PLANS[required].tier);
	return check.allowed ? null : c.json(planRequiredBody(required, check.plan), 403);
}

/** Middleware form of checkPlan; `methods` limits it to those HTTP methods. */
export const requirePlanTier = (required: GatedPlan, methods?: readonly string[]) =>
	createMiddleware<GateEnv>(async (c, next) => {
		if (methods && !methods.includes(c.req.method)) return next();
		const denied = await checkPlan(c, required);
		if (denied) return denied;
		await next();
	});

const ACCESS_TTL_MS = 30_000;
const accessCache = new Map<string, { ok: boolean; at: number }>();

/** Drop cached access verdicts (tests). */
export function clearAccessCache(): void {
	accessCache.clear();
}

async function accountHasAccess(db: Kysely<KlikapaDatabase>, accountId: string): Promise<boolean> {
	const cached = accessCache.get(accountId);
	if (cached && Date.now() - cached.at < ACCESS_TTL_MS) return cached.ok;
	const row = await db
		.selectFrom("users")
		.leftJoin("subscriptions", "subscriptions.user_id", "users.id")
		.select([
			"users.role",
			"subscriptions.plan",
			"subscriptions.status",
			"subscriptions.current_period_end",
		])
		.where("users.id", "=", accountId)
		.executeTakeFirst();
	const ok =
		row?.role === "super_admin" ||
		// No subscription row: account predates trials and keeps micro access.
		!row?.status ||
		isSubscriptionActive({
			plan: row.plan ?? "micro",
			status: row.status,
			current_period_end: row.current_period_end ?? null,
		});
	if (accessCache.size > 10_000) accessCache.clear();
	accessCache.set(accountId, { ok, at: Date.now() });
	return ok;
}

/**
 * Lapsed accounts lose analytics reads: GET requests answer
 * 402 { error: "subscription_inactive" }. The account checked is the owner of
 * the requested site_id (so team members follow the owner's plan), else the
 * caller. A super-admin caller always passes.
 */
export const requireActiveSubscription = createMiddleware<GateEnv>(async (c, next) => {
	if (c.req.method !== "GET") return next();
	const db = c.get("db");
	const userId = c.get("userId");
	const siteId = c.req.query("site_id");
	const site = siteId
		? await db.selectFrom("sites").select(["user_id"]).where("id", "=", siteId).executeTakeFirst()
		: undefined;
	if (await accountHasAccess(db, site?.user_id ?? userId)) return next();

	const caller = await db
		.selectFrom("users")
		.select(["role"])
		.where("id", "=", userId)
		.executeTakeFirst();
	if (caller?.role === "super_admin") return next();
	return c.json({ success: false, error: "subscription_inactive" }, 402);
});
