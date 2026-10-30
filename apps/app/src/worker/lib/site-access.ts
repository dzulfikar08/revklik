import type { Context } from "hono";
import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { sql } from "../db";
import { normalizeTeamRole, roleCan, type SiteAction, type SiteRole } from "./site-roles";

/** The subscription facts every plan or entitlement check reads about one account. */
export interface AccountPlan {
	role: string | null;
	plan: string | null;
	status: string | null;
	periodEnd: string | null;
}

/** One site as seen by the caller, with its owner's account. */
export interface SiteAccess {
	id: string;
	ownerId: string;
	domain: string;
	revenueCurrency: string | null;
	revenueCurrencySource: string | null;
	isOwner: boolean;
	/** The caller's role on this site: owner, a teammate's role, or null for a stranger. */
	role: SiteRole | null;
	/** Owner, or an ACCEPTED team member; a foreign site never lends access or plan. */
	canAccess: boolean;
	owner: AccountPlan;
}

export interface AccessSnapshot {
	caller: AccountPlan;
	/** Absent when no site id was named or the site does not exist. */
	site?: SiteAccess;
}

interface AccessRow {
	caller_role: string | null;
	caller_plan: string | null;
	caller_status: string | null;
	caller_period_end: string | null;
	site_id: string | null;
	owner_id: string | null;
	domain: string | null;
	revenue_currency: string | null;
	revenue_currency_source: string | null;
	member_id: string | null;
	member_role: string | null;
	owner_role: string | null;
	owner_plan: string | null;
	owner_status: string | null;
	owner_period_end: string | null;
}

interface RequestAccess {
	userId: string;
	snapshots: Map<string, Promise<AccessSnapshot>>;
	accounts: Map<string, AccountPlan>;
}

// Keyed by the request's own Kysely instance (createDb runs once per request),
// so nothing outlives the request and background jobs never see a memo.
const requests = new WeakMap<object, RequestAccess>();

/** Start memoizing access reads for this request's db (authMiddleware). */
export function beginRequestAccess(db: Kysely<KlikapaDatabase>, userId: string): void {
	requests.set(db, { userId, snapshots: new Map(), accounts: new Map() });
}

function accessFor(db: Kysely<KlikapaDatabase>, userId: string): RequestAccess | undefined {
	const request = requests.get(db);
	return request?.userId === userId ? request : undefined;
}

/** Account already read during this request for `userId`, if any. */
export function knownAccount(db: Kysely<KlikapaDatabase>, userId: string): AccountPlan | undefined {
	return requests.get(db)?.accounts.get(userId);
}

async function queryAccess(
	db: Kysely<KlikapaDatabase>,
	userId: string,
	siteId: string | undefined,
): Promise<AccessSnapshot> {
	// One round trip for caller, site, team membership and both subscriptions.
	// The derived `me` row keeps the result present even for an id with no users row.
	const { rows } = await sql<AccessRow>`
		SELECT cu.role AS caller_role, cs.plan AS caller_plan, cs.status AS caller_status,
			cs.current_period_end AS caller_period_end,
			s.id AS site_id, s.user_id AS owner_id, s.domain AS domain,
			s.revenue_currency AS revenue_currency,
			s.revenue_currency_source AS revenue_currency_source,
			tm.id AS member_id, tm.role AS member_role,
			ou.role AS owner_role, os.plan AS owner_plan, os.status AS owner_status,
			os.current_period_end AS owner_period_end
		FROM (SELECT ${userId} AS id) me
		LEFT JOIN users cu ON cu.id = me.id
		LEFT JOIN subscriptions cs ON cs.user_id = me.id
		LEFT JOIN sites s ON s.id = ${siteId ?? null}
		LEFT JOIN team_members tm
			ON tm.site_id = s.id AND tm.user_id = me.id AND tm.accepted_at IS NOT NULL
		LEFT JOIN users ou ON ou.id = s.user_id
		LEFT JOIN subscriptions os ON os.user_id = s.user_id
		LIMIT 1`.execute(db);
	const row = rows[0];
	const caller: AccountPlan = {
		role: row?.caller_role ?? null,
		plan: row?.caller_plan ?? null,
		status: row?.caller_status ?? null,
		periodEnd: row?.caller_period_end ?? null,
	};
	if (!row?.site_id || !row.owner_id) return { caller };
	const isOwner = row.owner_id === userId;
	return {
		caller,
		site: {
			id: row.site_id,
			ownerId: row.owner_id,
			domain: row.domain ?? "",
			revenueCurrency: row.revenue_currency,
			revenueCurrencySource: row.revenue_currency_source,
			isOwner,
			role: isOwner ? "owner" : row.member_id === null ? null : normalizeTeamRole(row.member_role),
			canAccess: isOwner || row.member_id !== null,
			owner: {
				role: row.owner_role,
				plan: row.owner_plan,
				status: row.owner_status,
				periodEnd: row.owner_period_end,
			},
		},
	};
}

/**
 * Who the caller is and what they may do on `siteId`, in a single D1 round trip.
 * Inside an authenticated request the first call settles the read and every
 * later one (validateSite, plan gates, query scope) reuses it.
 */
export function loadAccess(
	db: Kysely<KlikapaDatabase>,
	userId: string,
	siteId?: string | null,
): Promise<AccessSnapshot> {
	const site = siteId || undefined;
	const request = accessFor(db, userId);
	if (!request) return queryAccess(db, userId, site);
	const key = site ?? "";
	const memo = request.snapshots.get(key);
	if (memo) return memo;
	const pending = queryAccess(db, userId, site).then(
		(snapshot) => {
			request.accounts.set(userId, snapshot.caller);
			if (snapshot.site) request.accounts.set(snapshot.site.ownerId, snapshot.site.owner);
			return snapshot;
		},
		(err) => {
			request.snapshots.delete(key);
			throw err;
		},
	);
	request.snapshots.set(key, pending);
	return pending;
}

/**
 * Access snapshot for `siteId` this request already resolved (or resolves now),
 * whatever the caller's access to the site. Outside an authenticated request
 * there is no caller to resolve against: undefined, so the caller queries itself.
 */
export function requestAccess(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
): Promise<AccessSnapshot> | undefined {
	const request = requests.get(db);
	return request && loadAccess(db, request.userId, siteId);
}

export interface AccessCheck {
	site?: SiteAccess;
	/** Set when the caller may not do `action`: 404 for a stranger, 403 for a member without the role. */
	denied?: { status: 403 | 404; error: string };
}

/** Resolve the caller's access to one site; one memoized D1 read per request. */
export async function checkSiteAccess(
	db: Kysely<KlikapaDatabase>,
	userId: string,
	siteId: string | null | undefined,
	action: SiteAction = "read",
): Promise<AccessCheck> {
	const { site } = await loadAccess(db, userId, siteId);
	// Same answer for a missing site and one the caller has no part in: ids are not probeable.
	if (!site?.canAccess) return { denied: { status: 404, error: "Site not found" } };
	if (!roleCan(site.role, action)) {
		return { denied: { status: 403, error: "Your role on this site cannot do that" } };
	}
	return { site };
}

/** Any Hono env whose variables carry the request's db and authenticated user. */
type AccessEnv = { Variables: { db: Kysely<KlikapaDatabase>; userId: string } };

/**
 * The one access gate for site-scoped routes: returns the site, or the 404/403 response
 * to hand straight back.
 *
 * ```ts
 * const access = await requireSiteAccess(c, siteId, "write");
 * if (access instanceof Response) return access;
 * ```
 */
export async function requireSiteAccess<E extends AccessEnv>(
	c: Context<E>,
	siteId: string | null | undefined,
	action: SiteAction = "read",
): Promise<SiteAccess | Response> {
	const { site, denied } = await checkSiteAccess(c.get("db"), c.get("userId"), siteId, action);
	if (denied) return c.json({ error: denied.error, success: false }, denied.status);
	return site as SiteAccess;
}
