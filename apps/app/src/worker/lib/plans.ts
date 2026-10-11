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

export function getPlanLimits(plan: string) {
	return PLANS[plan as PlanTier] ?? PLANS.micro;
}

export function hasPremiumFeatures(plan: string): boolean {
	return (PLANS[plan as PlanTier]?.tier ?? 0) >= 2;
}

export function getApiRateLimit(plan: string): number {
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
		"Cookieless tracking",
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
import { isSubscriptionActive } from "./entitlement";

/**
 * Tier check against the caller's own subscription. Super admins always pass;
 * accounts without a subscription row (pre-trial signups) count as active micro.
 */
export async function requirePlan(
	db: Kysely<KlikapaDatabase>,
	userId: string,
	requiredTier: number,
): Promise<{ allowed: boolean; plan: string }> {
	const user = await db
		.selectFrom("users")
		.select(["role"])
		.where("id", "=", userId)
		.executeTakeFirst();
	if (user?.role === "super_admin") return { allowed: true, plan: "growth" };

	const sub = await db
		.selectFrom("subscriptions")
		.select(["plan", "status", "current_period_end"])
		.where("user_id", "=", userId)
		.executeTakeFirst();
	if (!sub) return { allowed: requiredTier <= PLANS.micro.tier, plan: "micro" };
	const tier = PLANS[sub.plan as PlanTier]?.tier ?? 0;
	return { allowed: isSubscriptionActive(sub) && tier >= requiredTier, plan: sub.plan };
}

/**
 * Tier check for a site-scoped feature: the site OWNER's plan decides (team
 * members ride on it). A super-admin caller always passes; an unknown site
 * falls back to the caller's own plan.
 */
export async function requirePlanForSite(
	db: Kysely<KlikapaDatabase>,
	userId: string,
	siteId: string | null | undefined,
	requiredTier: number,
): Promise<{ allowed: boolean; plan: string }> {
	const owner = siteId
		? await db.selectFrom("sites").select(["user_id"]).where("id", "=", siteId).executeTakeFirst()
		: undefined;
	if (!owner || owner.user_id === userId) return requirePlan(db, userId, requiredTier);
	const caller = await db
		.selectFrom("users")
		.select(["role"])
		.where("id", "=", userId)
		.executeTakeFirst();
	if (caller?.role === "super_admin") return { allowed: true, plan: "growth" };
	return requirePlan(db, owner.user_id, requiredTier);
}
