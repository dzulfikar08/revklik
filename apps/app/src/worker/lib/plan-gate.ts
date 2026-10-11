import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import type { Env } from "../types";
import { INGEST_GRACE_MS, isSubscriptionActive } from "./entitlement";
import { PLANS, type PlanTier, requirePlanForSite } from "./plans";

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

/** site_id from the query string, else from a JSON body (Hono caches the parse). */
async function requestSiteId(c: Context<GateEnv>): Promise<string | undefined> {
	const fromQuery = c.req.query("site_id");
	if (fromQuery) return fromQuery;
	if (!c.req.header("content-type")?.includes("application/json")) return undefined;
	const body = await c.req.json().catch(() => null);
	const siteId = (body as { site_id?: unknown } | null)?.site_id;
	return typeof siteId === "string" ? siteId : undefined;
}

/** 403 response when the site owner's (else caller's) plan is below `required`, else null. */
export async function checkPlan(
	c: Context<GateEnv>,
	required: GatedPlan,
): Promise<Response | null> {
	const check = await requirePlanForSite(
		c.get("db"),
		c.get("userId"),
		await requestSiteId(c),
		PLANS[required].tier,
	);
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
interface AccountAccess {
	ok: boolean;
	periodEnd: string | null;
	/** Days of history the plan may read; null = unlimited (super admin). */
	retentionDays: number | null;
}

const accessCache = new Map<string, AccountAccess & { at: number }>();

/** Drop cached access verdicts (tests). */
export function clearAccessCache(): void {
	accessCache.clear();
}

async function accountAccess(
	db: Kysely<KlikapaDatabase>,
	accountId: string,
): Promise<AccountAccess> {
	const cached = accessCache.get(accountId);
	if (cached && Date.now() - cached.at < ACCESS_TTL_MS) return cached;
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
	const plan = PLANS[(row?.plan ?? "micro") as PlanTier] ?? PLANS.micro;
	const verdict: AccountAccess = {
		ok,
		periodEnd: row?.current_period_end ?? null,
		retentionDays: row?.role === "super_admin" ? null : plan.retention_days,
	};
	if (accessCache.size > 10_000) accessCache.clear();
	accessCache.set(accountId, { ...verdict, at: Date.now() });
	return verdict;
}

/** Whole days of post-period ingest grace left (0 once it has run out). */
export function graceDaysRemaining(periodEnd: string | null, now = Date.now()): number {
	const end = periodEnd ? new Date(periodEnd).getTime() : Number.NaN;
	if (!Number.isFinite(end)) return 0;
	return Math.max(0, Math.ceil((end + INGEST_GRACE_MS - now) / 86_400_000));
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
	const access = await accountAccess(db, site?.user_id ?? userId);
	if (access.ok) {
		// Plan retention is a read window: older rows exist but are not served.
		if (access.retentionDays !== null) {
			c.set(
				"retentionFloor",
				new Date(Date.now() - access.retentionDays * 86_400_000).toISOString(),
			);
		}
		return next();
	}

	const caller = await db
		.selectFrom("users")
		.select(["role"])
		.where("id", "=", userId)
		.executeTakeFirst();
	if (caller?.role === "super_admin") return next();
	return c.json(
		{
			success: false,
			error: "subscription_inactive",
			grace_days_remaining: graceDaysRemaining(access.periodEnd),
		},
		402,
	);
});
