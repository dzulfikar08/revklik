import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "shared";
import { getPlanLimits } from "./plans";

interface CachedSiteMeta {
	plan: string;
	status: string;
	currentPeriodEnd: string;
	eventLimit: number;
	eventsUsed: number;
	cachedAt: number;
}

const siteMetaCache = new Map<string, CachedSiteMeta>();
const ACTIVE_TTL_MS = 60_000;
const INACTIVE_TTL_MS = 10_000;
const MAX_CACHE_SIZE = 10_000;

export interface SiteEnforcementResult {
	allowed: boolean;
	reason?:
		| "no_subscription"
		| "subscription_expired"
		| "subscription_inactive"
		| "quota_exceeded"
		| "premium_required";
	plan: string;
	eventsUsed: number;
	eventsLimit: number;
	periodEnd: string;
}

function getCurrentMonthStart(): string {
	const now = new Date();
	return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01T00:00:00Z`;
}

function evictIfNeeded() {
	if (siteMetaCache.size < MAX_CACHE_SIZE) return;
	const entries = [...siteMetaCache.entries()].sort(
		(a, b) => a[1].cachedAt - b[1].cachedAt,
	);
	const evictCount = Math.ceil(MAX_CACHE_SIZE * 0.2);
	for (let i = 0; i < evictCount; i++) {
		const key = entries[i]?.[0];
		if (key !== undefined) siteMetaCache.delete(key);
	}
}

const superAdminCache = new Map<string, boolean>();
const SUPER_ADMIN_TTL = 5 * 60_000;

export async function enforceSiteQuota(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	requirePremium?: boolean,
): Promise<SiteEnforcementResult> {
	const now = Date.now();
	const cached = siteMetaCache.get(siteId);

	if (cached) {
		const ttl = cached.status === "active" ? ACTIVE_TTL_MS : INACTIVE_TTL_MS;
		if (now - cached.cachedAt < ttl) {
			if (cached.status !== "active" && cached.status !== "trialing") {
				return {
					allowed: false,
					reason: "subscription_inactive",
					plan: cached.plan,
					eventsUsed: cached.eventsUsed,
					eventsLimit: cached.eventLimit,
					periodEnd: cached.currentPeriodEnd,
				};
			}
			if (
				cached.currentPeriodEnd &&
				new Date(cached.currentPeriodEnd) < new Date()
			) {
				return {
					allowed: false,
					reason: "subscription_expired",
					plan: cached.plan,
					eventsUsed: cached.eventsUsed,
					eventsLimit: cached.eventLimit,
					periodEnd: cached.currentPeriodEnd,
				};
			}
			if (requirePremium && cached.plan !== "growth") {
				return {
					allowed: false,
					reason: "premium_required",
					plan: cached.plan,
					eventsUsed: cached.eventsUsed,
					eventsLimit: cached.eventLimit,
					periodEnd: cached.currentPeriodEnd,
				};
			}
			if (cached.eventsUsed >= cached.eventLimit) {
				return {
					allowed: false,
					reason: "quota_exceeded",
					plan: cached.plan,
					eventsUsed: cached.eventsUsed,
					eventsLimit: cached.eventLimit,
					periodEnd: cached.currentPeriodEnd,
				};
			}
			return {
				allowed: true,
				plan: cached.plan,
				eventsUsed: cached.eventsUsed,
				eventsLimit: cached.eventLimit,
				periodEnd: cached.currentPeriodEnd,
			};
		}
	}

	// Cache miss: look up site owner's subscription + check super_admin in one pass
	const row = await db
		.selectFrom("sites")
		.innerJoin("subscriptions", "subscriptions.user_id", "sites.user_id")
		.select([
			"sites.user_id",
			"subscriptions.plan",
			"subscriptions.status",
			"subscriptions.current_period_end",
		])
		.where("sites.id", "=", siteId)
		.executeTakeFirst();

	let plan: string;
	let status: string;
	let periodEnd: string;

	if (!row) {
		const siteRow = await db
			.selectFrom("sites")
			.select(["user_id"])
			.where("id", "=", siteId)
			.executeTakeFirst();
		if (!siteRow)
			return {
				allowed: false,
				reason: "no_subscription",
				plan: "micro",
				eventsUsed: 0,
				eventsLimit: 0,
				periodEnd: "",
			};
		// Check super_admin for sites without subscription
		const saKey = siteRow.user_id;
		const saCached = superAdminCache.get(saKey);
		if (saCached)
			return {
				allowed: true,
				plan: "growth",
				eventsUsed: 0,
				eventsLimit: 999_999_999,
				periodEnd: "",
			};
		const saUser = await db
			.selectFrom("users")
			.select(["role"])
			.where("id", "=", saKey)
			.executeTakeFirst();
		if (saUser?.role === "super_admin") {
			superAdminCache.set(saKey, true);
			setTimeout(() => superAdminCache.delete(saKey), SUPER_ADMIN_TTL);
			return {
				allowed: true,
				plan: "growth",
				eventsUsed: 0,
				eventsLimit: 999_999_999,
				periodEnd: "",
			};
		}
		plan = "micro";
		status = "active";
		periodEnd = "";
	} else {
		// Check super_admin bypass (with cache)
		const saKey = row.user_id;
		const saCached = superAdminCache.get(saKey);
		if (saCached)
			return {
				allowed: true,
				plan: "growth",
				eventsUsed: 0,
				eventsLimit: 999_999_999,
				periodEnd: "",
			};
		const saUser = await db
			.selectFrom("users")
			.select(["role"])
			.where("id", "=", saKey)
			.executeTakeFirst();
		if (saUser?.role === "super_admin") {
			superAdminCache.set(saKey, true);
			setTimeout(() => superAdminCache.delete(saKey), SUPER_ADMIN_TTL);
			return {
				allowed: true,
				plan: "growth",
				eventsUsed: 0,
				eventsLimit: 999_999_999,
				periodEnd: "",
			};
		}
		plan = row.plan;
		status = row.status;
		periodEnd = row.current_period_end;
	}

	// Count events for current month
	const monthStart = getCurrentMonthStart();
	const countRow = await db
		.selectFrom("events")
		.select(({ fn }) => [fn.count<number>("id").as("cnt")])
		.where("site_id", "=", siteId)
		.where("timestamp", ">=", monthStart)
		.executeTakeFirst();
	const eventsUsed = Number(countRow?.cnt ?? 0);
	const eventLimit = getPlanLimits(plan).events_per_month;

	const meta: CachedSiteMeta = {
		plan,
		status,
		currentPeriodEnd: periodEnd,
		eventLimit,
		eventsUsed,
		cachedAt: now,
	};
	evictIfNeeded();
	siteMetaCache.set(siteId, meta);

	if (status !== "active" && status !== "trialing") {
		return {
			allowed: false,
			reason: "subscription_inactive",
			plan,
			eventsUsed,
			eventsLimit: eventLimit,
			periodEnd,
		};
	}
	if (periodEnd && new Date(periodEnd) < new Date()) {
		return {
			allowed: false,
			reason: "subscription_expired",
			plan,
			eventsUsed,
			eventsLimit: eventLimit,
			periodEnd,
		};
	}
	if (requirePremium && plan !== "growth") {
		return {
			allowed: false,
			reason: "premium_required",
			plan,
			eventsUsed,
			eventsLimit: eventLimit,
			periodEnd,
		};
	}
	if (eventsUsed >= eventLimit) {
		return {
			allowed: false,
			reason: "quota_exceeded",
			plan,
			eventsUsed,
			eventsLimit: eventLimit,
			periodEnd,
		};
	}

	return {
		allowed: true,
		plan,
		eventsUsed,
		eventsLimit: eventLimit,
		periodEnd,
	};
}

export function incrementCachedCount(siteId: string, count: number = 1) {
	const cached = siteMetaCache.get(siteId);
	if (cached) cached.eventsUsed += count;
}
