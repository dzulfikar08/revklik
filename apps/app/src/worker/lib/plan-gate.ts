import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import type { Env } from "../types";
import { INGEST_GRACE_MS, isSelfHosted, isSubscriptionActive } from "./entitlement";
import { PLANS, type PlanTier, requirePlanForSite } from "./plans";
import { type AccountPlan, loadAccess } from "./site-access";

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

/** Site a path-addressed resource belongs to (e.g. /integrations/:id), if any. */
export type ResourceSiteResolver = (c: Context<GateEnv>) => Promise<string | undefined>;

/**
 * Every site the request names: the addressed resource's own site, the query
 * site_id and the body site_id. Handlers call c.req.json() whatever the
 * content-type, so the body is always parsed here too (Hono caches the parse
 * for the handler). `conflict` when any two disagree: the gate must never
 * check one site while the handler acts on another.
 */
async function requestSiteId(
	c: Context<GateEnv>,
	resolveResource?: ResourceSiteResolver,
): Promise<{ siteId?: string; conflict?: boolean }> {
	const named: string[] = [];
	if (resolveResource) {
		const own = await resolveResource(c);
		if (own) named.push(own);
	}
	const fromQuery = c.req.query("site_id");
	if (fromQuery) named.push(fromQuery);
	if (c.req.method !== "GET" && c.req.method !== "HEAD") {
		const body = await c.req.json().catch(() => null);
		const raw = (body as { site_id?: unknown } | null)?.site_id;
		if (typeof raw === "string" && raw) named.push(raw);
	}
	if (new Set(named).size > 1) return { conflict: true };
	return { siteId: named[0] };
}

/** 403 response when the site owner's (else caller's) plan is below `required`, else null. */
export async function checkPlan(
	c: Context<GateEnv>,
	required: GatedPlan,
	resolveResource?: ResourceSiteResolver,
): Promise<Response | null> {
	// Self-hosted: every plan gate is open (and the body is left unparsed).
	if (isSelfHosted(c.env)) return null;
	const target = await requestSiteId(c, resolveResource);
	if (target.conflict) {
		return c.json({ success: false, error: "Request names more than one site" }, 400);
	}
	const check = await requirePlanForSite(
		c.get("db"),
		c.get("userId"),
		target.siteId,
		PLANS[required].tier,
	);
	return check.allowed ? null : c.json(planRequiredBody(required, check.plan), 403);
}

/** Middleware form of checkPlan; `methods` limits it to those HTTP methods. */
export const requirePlanTier = (
	required: GatedPlan,
	methods?: readonly string[],
	resolveResource?: ResourceSiteResolver,
) =>
	createMiddleware<GateEnv>(async (c, next) => {
		if (methods && !methods.includes(c.req.method)) return next();
		const denied = await checkPlan(c, required, resolveResource);
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

function toAccountAccess(account: AccountPlan): AccountAccess {
	const ok =
		account.role === "super_admin" ||
		// No subscription row: account predates trials and keeps micro access.
		!account.status ||
		isSubscriptionActive({
			plan: account.plan ?? "micro",
			status: account.status,
			current_period_end: account.periodEnd,
		});
	const plan = PLANS[(account.plan ?? "micro") as PlanTier] ?? PLANS.micro;
	return {
		ok,
		periodEnd: account.periodEnd,
		retentionDays: account.role === "super_admin" ? null : plan.retention_days,
	};
}

/**
 * Verdict for the account that decides this request: the owner of an accessible
 * `siteId`, else the caller. A request naming a site settles everything in one
 * shared read; site-less requests reuse a short-lived per-account verdict.
 */
async function resolveAccess(
	db: Kysely<KlikapaDatabase>,
	userId: string,
	siteId: string | undefined,
): Promise<{ access: AccountAccess; callerIsSuperAdmin: boolean }> {
	if (!siteId) {
		const cached = accessCache.get(userId);
		// A cached lapse is the caller's own, and a super admin never lapses.
		if (cached && Date.now() - cached.at < ACCESS_TTL_MS) {
			return { access: cached, callerIsSuperAdmin: false };
		}
	}
	const { caller, site } = await loadAccess(db, userId, siteId);
	const access = toAccountAccess(site?.canAccess ? site.owner : caller);
	if (!siteId) {
		if (accessCache.size > 10_000) accessCache.clear();
		accessCache.set(userId, { ...access, at: Date.now() });
	}
	return { access, callerIsSuperAdmin: caller.role === "super_admin" };
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
	if (c.req.method !== "GET" || isSelfHosted(c.env)) return next();
	const db = c.get("db");
	const userId = c.get("userId");
	// Only a site the caller belongs to lends its owner's subscription.
	const { access, callerIsSuperAdmin } = await resolveAccess(db, userId, c.req.query("site_id"));
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

	if (callerIsSuperAdmin) return next();
	return c.json(
		{
			success: false,
			error: "subscription_inactive",
			grace_days_remaining: graceDaysRemaining(access.periodEnd),
		},
		402,
	);
});
