import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { type ChunkedDeleteResult, purgeSiteRows, SITE_DELETE_ROUNDS } from "./purge";

/** Tables holding one row per interaction, keyed by (site_id, visitor_id). */
const VISITOR_TABLES = [
	"sessions",
	"visitor_profiles",
	"heatmap_clicks",
	"heatmap_scrolls",
	"session_recordings",
] as const;

/**
 * Payment events (money or a provider reference) are bookkeeping records: erasing a
 * visitor keeps them but cuts the link to the person. Same predicate as the
 * retention purge's `keep` clause, inverted.
 */
const PAYMENT_EVENT = "(COALESCE(revenue, 0) != 0 OR external_id IS NOT NULL)";

export interface VisitorErasure {
	events: number;
	sessions: number;
	profiles: number;
	recordings: number;
	heatmap_rows: number;
	payments_anonymized: number;
}

const rowCount = (result: unknown): number =>
	(result as { results?: unknown[] } | undefined)?.results?.length ?? 0;

/**
 * Erase one visitor of one site, atomically (a single D1 batch): browsing events,
 * sessions, the profile with its name/email/phone, recordings and heatmap rows are
 * deleted. Payment events stay with every personal field removed and a unique
 * `erased:` visitor id, so revenue and distinct-buyer counts keep adding up.
 */
export async function eraseVisitor(
	d1: D1Database,
	siteId: string,
	visitorId: string,
): Promise<VisitorErasure> {
	const deleteFrom = (table: string) =>
		d1
			.prepare(`DELETE FROM ${table} WHERE site_id = ?1 AND visitor_id = ?2 RETURNING 1 AS gone`)
			.bind(siteId, visitorId);
	const statements = [
		d1
			.prepare(
				`DELETE FROM events WHERE site_id = ?1 AND visitor_id = ?2 AND NOT ${PAYMENT_EVENT} RETURNING 1 AS gone`,
			)
			.bind(siteId, visitorId),
		d1
			.prepare(
				`UPDATE events SET visitor_id = 'erased:' || id, props = NULL, fingerprint = NULL,
				        city = NULL, region = NULL, browser = NULL, os = NULL, device_type = NULL
				 WHERE site_id = ?1 AND visitor_id = ?2 AND ${PAYMENT_EVENT} RETURNING 1 AS gone`,
			)
			.bind(siteId, visitorId),
		...VISITOR_TABLES.map(deleteFrom),
	];
	const results = await d1.batch(statements);
	return {
		events: rowCount(results[0]),
		payments_anonymized: rowCount(results[1]),
		sessions: rowCount(results[2]),
		profiles: rowCount(results[3]),
		heatmap_rows: rowCount(results[4]) + rowCount(results[5]),
		recordings: rowCount(results[6]),
	};
}

/** A visitor's data as the site owner holds it, for an access request. Null when nothing is stored. */
export async function exportVisitor(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	visitorId: string,
) {
	const profile = await db
		.selectFrom("visitor_profiles")
		.select([
			"visitor_id",
			"name",
			"email",
			"phone",
			"first_seen",
			"last_seen",
			"country",
			"region",
			"city",
			"device_type",
			"browser",
			"os",
			"total_sessions",
			"total_pageviews",
			"total_revenue",
			"tags",
			"notes",
		])
		.where("site_id", "=", siteId)
		.where("visitor_id", "=", visitorId)
		.executeTakeFirst();
	const sessions = await db
		.selectFrom("sessions")
		.select([
			"id",
			"started_at",
			"ended_at",
			"entry_path",
			"exit_path",
			"referrer",
			"utm_source",
			"utm_medium",
			"utm_campaign",
			"country",
			"region",
			"city",
			"device_type",
			"browser",
			"os",
			"page_count",
		])
		.where("site_id", "=", siteId)
		.where("visitor_id", "=", visitorId)
		.orderBy("started_at", "asc")
		.limit(5_000)
		.execute();
	const events = await db
		.selectFrom("events")
		.select([
			"id",
			"session_id",
			"timestamp",
			"event_type",
			"name",
			"path",
			"referrer",
			"revenue",
			"currency",
			"props",
		])
		.where("site_id", "=", siteId)
		.where("visitor_id", "=", visitorId)
		.orderBy("timestamp", "asc")
		.limit(20_000)
		.execute();
	if (!profile && sessions.length === 0 && events.length === 0) return null;
	return { profile: profile ?? null, sessions, events };
}

/** Tables named user_id, deleted outright when an account goes. */
const USER_OWNED_TABLES = [
	"team_members",
	"integrations",
	"annotations",
	"email_reports",
	"fee_rules",
	"account_usage",
	"push_devices",
	"push_prefs",
	"push_outbox",
	"password_resets",
	"email_verifications",
	"account_link_intents",
	"oauth_codes",
	"subscriptions",
] as const;

export interface AccountErasure {
	/** Site tables that still held rows; call again until empty. */
	unfinished: string[];
}

/**
 * Delete an account and everything it owns. Owned sites go first, in bounded chunks
 * (see purgeSiteRows): a very large account answers unfinished != [] and the caller
 * repeats the request. Only when every site is gone does the account row follow, so an
 * interrupted run never leaves an owner-less site behind or locks the owner out of retrying.
 *
 * Payment records of RevKlik's own billing (pakasir_orders) are kept, anonymised: order
 * ids still guard against replayed webhooks. The payment processor keeps its own records.
 */
export async function deleteAccount(
	d1: D1Database,
	userId: string,
	email: string,
	siteRounds = SITE_DELETE_ROUNDS,
): Promise<AccountErasure> {
	const owned = await d1
		.prepare("SELECT id FROM sites WHERE user_id = ?1")
		.bind(userId)
		.all<{ id: string }>();
	for (const { id } of owned.results ?? []) {
		const purge: ChunkedDeleteResult = await purgeSiteRows(d1, id, siteRounds);
		if (purge.unfinished.length > 0) return { unfinished: purge.unfinished };
		await d1.prepare("DELETE FROM sites WHERE id = ?1").bind(id).run();
	}

	const byUser = (table: string) =>
		d1.prepare(`DELETE FROM ${table} WHERE user_id = ?1`).bind(userId);
	await d1.batch([
		...USER_OWNED_TABLES.map(byUser),
		d1.prepare("UPDATE team_members SET invited_by = 'deleted' WHERE invited_by = ?1").bind(userId),
		d1.prepare("DELETE FROM account_links WHERE user_a = ?1 OR user_b = ?1").bind(userId),
		d1.prepare("DELETE FROM account_link_flows WHERE owner_id = ?1 OR target_id = ?1").bind(userId),
		d1
			.prepare(
				"DELETE FROM referrals WHERE referred_user_id = ?1 OR affiliate_id IN (SELECT id FROM affiliates WHERE user_id = ?1)",
			)
			.bind(userId),
		d1.prepare("DELETE FROM affiliates WHERE user_id = ?1").bind(userId),
		d1.prepare("UPDATE pakasir_orders SET user_id = 'deleted' WHERE user_id = ?1").bind(userId),
		d1
			.prepare("DELETE FROM login_attempts WHERE key IN (?1, ?2)")
			.bind(`login-email:${email}`, `link-user:${userId}`),
		// The session that made this request dies with the rest, so it goes last.
		byUser("api_keys"),
		d1.prepare("DELETE FROM users WHERE id = ?1").bind(userId),
	]);
	return { unfinished: [] };
}
