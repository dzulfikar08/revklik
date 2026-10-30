export const PLANS = {
	micro: {
		name: "Micro",
		price: 1,
		events_per_month: 10_000,
		sites: 1,
		retention_days: 7,
		tier: 0,
	},
	starter: {
		name: "Starter",
		price: 4,
		events_per_month: 100_000,
		sites: 3,
		retention_days: 30,
		tier: 1,
	},
	growth: {
		name: "Growth",
		price: 12,
		events_per_month: 500_000,
		sites: 10,
		retention_days: 90,
		tier: 2,
	},
} as const;

export type PlanTier = keyof typeof PLANS;

/** Limits of a self-hosted instance: nothing is capped. */
export const UNLIMITED = 999_999_999;
export const SELF_HOSTED_LIMITS = {
	name: "Self-hosted",
	price: 0,
	events_per_month: UNLIMITED,
	sites: UNLIMITED,
	retention_days: UNLIMITED,
	tier: PLANS.growth.tier,
} as const;

export function getPlanLimits(plan: string, selfHosted = false) {
	if (selfHosted) return SELF_HOSTED_LIMITS;
	return PLANS[plan as PlanTier] ?? PLANS.micro;
}

export function hasPremiumFeatures(plan: string): boolean {
	return (PLANS[plan as PlanTier]?.tier ?? 0) >= 2;
}

export function getApiRateLimit(plan: string, selfHosted = false): number {
	if (selfHosted) return 6000;
	const limits: Record<string, number> = {
		micro: 30,
		starter: 120,
		growth: 300,
	};
	return limits[plan] ?? 30;
}

export function getFeatures(tier: PlanTier): string[] {
	const base = [
		"Privacy-first analytics",
		"No third-party cookies",
		"Visitor profiles",
		"UTM tracking",
		"CSV export",
	];
	if (tier === "micro")
		return [...base, "1 site", "10K events/month", "<4KB gzipped script", "7-day retention"];
	if (tier === "starter")
		return [
			...base,
			"3 sites",
			"100K events/month",
			"<4KB gzipped script",
			"30-day retention",
			"Funnel conversion",
			"Revenue attribution",
			"Real-time dashboard",
		];
	return [
		...base,
		"10 sites",
		"500K events/month",
		"Full script",
		"90-day retention",
		"AI insights",
		"Heatmaps",
		"Session replays",
		"Integrations",
		"Priority support",
		"Team members",
	];
}

import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { effectiveSubscription, isSubscriptionActive } from "./entitlement";
import { type AccountPlan, knownAccount, loadAccess } from "./site-access";

/**
 * Tier check against the caller's own subscription. Super admins always pass;
 * accounts without a subscription row (pre-trial signups) count as active micro.
 */
export async function requirePlan(
	db: Kysely<KlikapaDatabase>,
	userId: string,
	requiredTier: number,
	selfHosted = false,
): Promise<{ allowed: boolean; plan: string }> {
	// Self-hosted: the entitlement is the top tier for everyone, no lookup needed.
	if (selfHosted) return evaluate(effectiveSubscription(undefined, true), requiredTier);
	const account = knownAccount(db, userId) ?? (await loadAccess(db, userId)).caller;
	return evaluateAccount(account, requiredTier);
}

function evaluate(
	sub: { plan: string; status: string; current_period_end: string | null } | null | undefined,
	requiredTier: number,
): { allowed: boolean; plan: string } {
	if (!sub) return { allowed: requiredTier <= PLANS.micro.tier, plan: "micro" };
	const tier = PLANS[sub.plan as PlanTier]?.tier ?? 0;
	return { allowed: isSubscriptionActive(sub) && tier >= requiredTier, plan: sub.plan };
}

function evaluateAccount(
	account: AccountPlan,
	requiredTier: number,
): { allowed: boolean; plan: string } {
	if (account.role === "super_admin") return { allowed: true, plan: "growth" };
	return evaluate(
		account.status
			? {
					plan: account.plan ?? "micro",
					status: account.status,
					current_period_end: account.periodEnd,
				}
			: null,
		requiredTier,
	);
}

/**
 * Tier check for a site-scoped feature: the site OWNER's plan decides when the
 * caller is the owner or an accepted member; otherwise the caller's own plan.
 * A super-admin caller always passes.
 */
export async function requirePlanForSite(
	db: Kysely<KlikapaDatabase>,
	userId: string,
	siteId: string | null | undefined,
	requiredTier: number,
	selfHosted = false,
): Promise<{ allowed: boolean; plan: string }> {
	if (selfHosted) return requirePlan(db, userId, requiredTier, true);
	const { caller, site } = await loadAccess(db, userId, siteId);
	if (!site?.canAccess || site.isOwner || caller.role === "super_admin") {
		return evaluateAccount(caller, requiredTier);
	}
	return evaluateAccount(site.owner, requiredTier);
}
