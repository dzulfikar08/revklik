import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { sql } from "../db";

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
			tm.id AS member_id,
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
