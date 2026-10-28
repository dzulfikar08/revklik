import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { getAccountEventsUsed, usageMonth } from "./account-usage";
import { isIngestAllowed, isSubscriptionActive, type SubscriptionState } from "./entitlement";
import { getPlanLimits, UNLIMITED } from "./plans";

interface CachedSiteOwner {
	ownerId: string;
	superAdmin: boolean;
	plan: string;
	status: string;
	currentPeriodEnd: string;
	cachedAt: number;
}

interface CachedUsage {
	month: string;
	used: number;
	cachedAt: number;
}

const siteOwnerCache = new Map<string, CachedSiteOwner>();
const usageCache = new Map<string, CachedUsage>();
const ACTIVE_TTL_MS = 60_000;
const INACTIVE_TTL_MS = 10_000;
const USAGE_TTL_MS = 60_000;
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
	/** Account the site's events are billed to; absent when the site is unknown. */
	ownerId?: string;
}

function evictOldest<V extends { cachedAt: number }>(cache: Map<string, V>) {
	if (cache.size < MAX_CACHE_SIZE) return;
	const entries = [...cache.entries()].sort((a, b) => a[1].cachedAt - b[1].cachedAt);
	for (const [key] of entries.slice(0, Math.ceil(MAX_CACHE_SIZE * 0.2))) cache.delete(key);
}

/** Drop every cached owner/usage entry (tests, and after billing changes in-isolate). */
export function clearSubscriptionCaches(): void {
	siteOwnerCache.clear();
	usageCache.clear();
}

function toState(meta: CachedSiteOwner): SubscriptionState {
	return {
		plan: meta.plan,
		status: meta.status,
		current_period_end: meta.currentPeriodEnd || null,
	};
}

async function loadSiteOwner(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	now: number,
): Promise<CachedSiteOwner | null> {
	const row = await db
		.selectFrom("sites")
		.leftJoin("subscriptions", "subscriptions.user_id", "sites.user_id")
		.leftJoin("users", "users.id", "sites.user_id")
		.select([
			"sites.user_id",
			"users.role",
			"subscriptions.plan",
			"subscriptions.status",
			"subscriptions.current_period_end",
		])
		.where("sites.id", "=", siteId)
		.executeTakeFirst();
	if (!row) return null;
	// Accounts without a subscription row predate trials: they keep micro access.
	const meta: CachedSiteOwner = {
		ownerId: row.user_id,
		superAdmin: row.role === "super_admin",
		plan: row.plan ?? "micro",
		status: row.status ?? "active",
		currentPeriodEnd: row.current_period_end ?? "",
		cachedAt: now,
	};
	evictOldest(siteOwnerCache);
	siteOwnerCache.set(siteId, meta);
	return meta;
}

async function accountUsage(
	db: Kysely<KlikapaDatabase>,
	ownerId: string,
	now: number,
): Promise<number> {
	const month = usageMonth(new Date(now));
	const cached = usageCache.get(ownerId);
	if (cached && cached.month === month && now - cached.cachedAt < USAGE_TTL_MS) return cached.used;
	const used = await getAccountEventsUsed(db, ownerId, new Date(now));
	evictOldest(usageCache);
	usageCache.set(ownerId, { month, used, cachedAt: now });
	return used;
}

/**
 * Ingest gate for a site. Quota is per account (every site of the owner, read
 * from the account_usage counter); ingest keeps flowing through the
 * post-period grace window (INGEST_GRACE_MS) before events are dropped.
 */
export async function enforceSiteQuota(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	requirePremium?: boolean,
	selfHosted = false,
): Promise<SiteEnforcementResult> {
	try {
		return await enforceSiteQuotaOrThrow(db, siteId, requirePremium, selfHosted);
	} catch (err) {
		// Fail open: a DB hiccup must not silently drop a customer's traffic.
		console.error(`[quota] site ${siteId}: enforcement failed, ingesting anyway:`, err);
		return {
			allowed: true,
			plan: "unknown",
			eventsUsed: 0,
			eventsLimit: UNLIMITED,
			periodEnd: "",
		};
	}
}

async function enforceSiteQuotaOrThrow(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	requirePremium?: boolean,
	selfHosted = false,
): Promise<SiteEnforcementResult> {
	const now = Date.now();
	const cached = siteOwnerCache.get(siteId);
	const ttl =
		cached && isSubscriptionActive(toState(cached), now) ? ACTIVE_TTL_MS : INACTIVE_TTL_MS;
	const meta =
		cached && now - cached.cachedAt < ttl ? cached : await loadSiteOwner(db, siteId, now);
	if (!meta) {
		return {
			allowed: false,
			reason: "no_subscription",
			plan: "micro",
			eventsUsed: 0,
			eventsLimit: 0,
			periodEnd: "",
		};
	}
	if (meta.superAdmin || selfHosted) {
		return {
			allowed: true,
			plan: "growth",
			eventsUsed: 0,
			eventsLimit: UNLIMITED,
			periodEnd: "",
			ownerId: meta.ownerId,
		};
	}

	const eventsUsed = await accountUsage(db, meta.ownerId, now);
	const base = {
		plan: meta.plan,
		eventsUsed,
		eventsLimit: getPlanLimits(meta.plan).events_per_month,
		periodEnd: meta.currentPeriodEnd,
		ownerId: meta.ownerId,
	};
	if (!isIngestAllowed(toState(meta), now)) {
		const lapsed = meta.status === "active" || meta.status === "trialing";
		return {
			...base,
			allowed: false,
			reason: lapsed ? "subscription_expired" : "subscription_inactive",
		};
	}
	if (requirePremium && meta.plan !== "growth") {
		return { ...base, allowed: false, reason: "premium_required" };
	}
	if (eventsUsed >= base.eventsLimit) return { ...base, allowed: false, reason: "quota_exceeded" };
	return { ...base, allowed: true };
}

/** Count freshly ingested events against the owner's cached usage. */
export function incrementCachedUsage(ownerId: string, count = 1): void {
	const cached = usageCache.get(ownerId);
	if (cached) cached.used += count;
}
