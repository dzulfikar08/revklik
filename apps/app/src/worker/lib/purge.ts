import { getPlanLimits } from "./plans";
import { SALTED_FINGERPRINT_PREFIX } from "./visitor-hash";

/** Rows removed per DELETE; keeps each statement well inside D1's time limits. */
export const PURGE_CHUNK = 5_000;

/** Every table keyed by site_id, in the order a site delete clears them. */
export const SITE_SCOPED_TABLES = [
	"events",
	"sessions",
	"visitor_profiles",
	"heatmap_clicks",
	"heatmap_scrolls",
	"heatmap_aggregates",
	"session_recordings",
	"crawler_hits",
	"webhook_events",
	"webhook_logs",
	"ai_insights",
	"integrations",
	"payment_providers",
	"segments",
	"annotations",
	"email_reports",
	"search_console_data",
	"marketplace_orders",
	"asc_daily_metrics",
	"asc_daily_country",
	"team_members",
	"api_keys",
] as const;

/**
 * Raw tables the retention purge trims, with their time column. `keep` is an
 * extra predicate rows must also match to be deleted: payment events (money or a
 * provider reference) are bookkeeping records and outlive the window.
 */
export const RETENTION_TABLES: ReadonlyArray<{ table: string; column: string; keep?: string }> = [
	{
		table: "events",
		column: "timestamp",
		keep: "COALESCE(revenue, 0) = 0 AND external_id IS NULL",
	},
	{ table: "sessions", column: "started_at" },
	{ table: "visitor_profiles", column: "last_seen" },
	{ table: "crawler_hits", column: "timestamp" },
	{ table: "session_recordings", column: "started_at" },
	{ table: "heatmap_clicks", column: "timestamp" },
	{ table: "heatmap_scrolls", column: "timestamp" },
	{ table: "webhook_logs", column: "created_at" },
];

const IDENT_RE = /^[a-z_]+$/;

/** Shortest hard-delete horizon: Micro's 7-day window doubled would be 14 days, so a lapsed or late-renewing account still gets a month. */
export const MIN_PURGE_DAYS = 30;

export interface ChunkedDeleteResult {
	deleted: number;
	/** DELETE statements issued (one per table per round). */
	statements: number;
	/** Tables that still had rows when maxRounds ran out. */
	unfinished: string[];
}

/**
 * Delete rows matching `where` in PURGE_CHUNK slices, one statement per table
 * per D1 batch round, until each table runs dry or maxRounds is hit. Callers
 * pass predicates that lead with an indexed column (site_id) so each slice is
 * an index range, not a table scan.
 */
export async function deleteInChunks(
	d1: D1Database,
	targets: ReadonlyArray<{ table: string; where: string; params: unknown[] }>,
	maxRounds = 1_000,
): Promise<ChunkedDeleteResult> {
	let pending = targets.filter((t) => IDENT_RE.test(t.table));
	let deleted = 0;
	let statements = 0;
	for (let round = 0; round < maxRounds && pending.length > 0; round++) {
		const stmts = pending.map((t) =>
			d1
				.prepare(
					`DELETE FROM ${t.table} WHERE rowid IN (SELECT rowid FROM ${t.table} WHERE ${t.where} LIMIT ${PURGE_CHUNK}) RETURNING 1 AS gone`,
				)
				.bind(...t.params),
		);
		statements += stmts.length;
		const results = (await d1.batch(stmts)) as Array<{ results?: unknown[] }>;
		const next: typeof pending = [];
		pending.forEach((t, i) => {
			const n = results[i]?.results?.length ?? 0;
			deleted += n;
			if (n >= PURGE_CHUNK) next.push(t);
		});
		pending = next;
	}
	return { deleted, statements, unfinished: pending.map((t) => t.table) };
}

/** Rounds one site-delete request may spend before handing back 202. */
export const SITE_DELETE_ROUNDS = 40;

/** Remove rows belonging to a site; `unfinished` non-empty means call again. */
export function purgeSiteRows(
	d1: D1Database,
	siteId: string,
	maxRounds = SITE_DELETE_ROUNDS,
): Promise<ChunkedDeleteResult> {
	return deleteInChunks(
		d1,
		SITE_SCOPED_TABLES.map((table) => ({ table, where: "site_id = ?", params: [siteId] })),
		maxRounds,
	);
}

/**
 * Hard-delete horizon for one account, in days; null keeps data forever.
 *
 * Hosted: twice the plan's reporting window (the dashboard compares each period
 * with the one before it), never under MIN_PURGE_DAYS, so Micro keeps 30 days,
 * Starter 60 and Growth 180. A super admin never loses data. RETENTION_HARD_DELETE_DAYS
 * is ignored on hosted: the plan decides.
 * Self-hosted: no plan, so nothing is purged unless RETENTION_HARD_DELETE_DAYS is set
 * (values under MIN_PURGE_DAYS are refused).
 */
export function retentionPurgeDays(opts: {
	plan: string | null | undefined;
	role: string | null | undefined;
	selfHosted: boolean;
	hardDeleteDays?: string;
}): number | null {
	if (opts.selfHosted) {
		const days = Number(opts.hardDeleteDays);
		if (!opts.hardDeleteDays || !Number.isFinite(days)) return null;
		if (days < MIN_PURGE_DAYS) {
			console.error(
				`RETENTION_HARD_DELETE_DAYS=${opts.hardDeleteDays} refused (minimum ${MIN_PURGE_DAYS})`,
			);
			return null;
		}
		return days;
	}
	if (opts.role === "super_admin") return null;
	const plan = getPlanLimits(opts.plan ?? "micro");
	return Math.max(MIN_PURGE_DAYS, plan.retention_days * 2);
}

/** Statements one purge run may spend; the rest resumes at the next nightly run (D1 caps queries per invocation). */
export const PURGE_STATEMENT_BUDGET = 600;

export interface PurgeOptions {
	selfHosted: boolean;
	/** RETENTION_HARD_DELETE_DAYS; only read on self-hosted installs. */
	hardDeleteDays?: string;
	now?: number;
	/** Rounds per site before moving to the next one. */
	maxRoundsPerSite?: number;
	/** Statements this run may spend before leaving the remaining sites for the next one. */
	statementBudget?: number;
}

const PURGE_CURSOR_KEY = "retention_purge_cursor";

/**
 * Hard-delete raw analytics past each site owner's retention horizon, site by
 * site so every slice rides the (site_id, time) indexes. Payment rows (money or
 * a provider reference) stay as bookkeeping records. Returns the rows deleted.
 */
export async function purgeExpiredRows(d1: D1Database, opts: PurgeOptions): Promise<number> {
	const now = opts.now ?? Date.now();
	const found = await d1
		.prepare(
			`SELECT s.id AS id, u.role AS role,
			        (SELECT plan FROM subscriptions WHERE user_id = s.user_id LIMIT 1) AS plan
			 FROM sites s LEFT JOIN users u ON u.id = s.user_id ORDER BY s.id`,
		)
		.all<{ id: string; role: string | null; plan: string | null }>();
	// A run that ran out of budget resumes after the last site it finished, so a site with a
	// huge backlog cannot keep the ones behind it from ever being reached.
	const cursor = await d1
		.prepare("SELECT value FROM system_state WHERE key = ?1")
		.bind(PURGE_CURSOR_KEY)
		.first<{ value: string }>();
	const all = found.results ?? [];
	const split = cursor ? all.findIndex((s) => s.id > cursor.value) : 0;
	const sites = split <= 0 ? all : [...all.slice(split), ...all.slice(0, split)];

	let deleted = 0;
	let statements = 0;
	let outOfBudget = false;
	let lastDone: string | null = null;
	for (const site of sites) {
		const days = retentionPurgeDays({ ...opts, plan: site.plan, role: site.role });
		if (days === null) continue;
		if (statements >= (opts.statementBudget ?? PURGE_STATEMENT_BUDGET)) {
			console.log("Retention purge: statement budget spent, remaining sites resume next run");
			outOfBudget = true;
			break;
		}
		const cutoff = new Date(now - days * 86_400_000).toISOString();
		const result = await deleteInChunks(
			d1,
			RETENTION_TABLES.map(({ table, column, keep }) => ({
				table,
				where: `site_id = ? AND ${column} < ?${keep ? ` AND ${keep}` : ""}`,
				params: [site.id, cutoff],
			})),
			opts.maxRoundsPerSite ?? 20,
		);
		deleted += result.deleted;
		statements += result.statements;
		lastDone = site.id;
	}
	if (outOfBudget && lastDone) {
		await d1
			.prepare(
				"INSERT INTO system_state (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
			)
			.bind(PURGE_CURSOR_KEY, lastDone, new Date(now).toISOString())
			.run();
	} else {
		await d1.prepare("DELETE FROM system_state WHERE key = ?1").bind(PURGE_CURSOR_KEY).run();
	}
	return deleted;
}

const LEGACY_FINGERPRINT_STATE = "fingerprint_scrub_done";
const SCRUB_CHUNK = 2_000;
const SCRUB_ROUNDS = 30;

/**
 * Before per-site salting, every event, session and profile carried a bare
 * SHA-256 of IP, browser, language and screen size. Salted values start with
 * SALTED_FINGERPRINT_PREFIX; anything else is legacy and is blanked here, in
 * rowid-keyed slices (resumable: a later run continues where the budget ended).
 * Self-traffic blocklists were re-keyed by the v25 migration, so only
 * identifiers nobody can use any more are dropped. Returns rows blanked.
 */
export async function scrubLegacyFingerprints(d1: D1Database): Promise<number> {
	const done = await d1
		.prepare("SELECT value FROM system_state WHERE key = ?1")
		.bind(LEGACY_FINGERPRINT_STATE)
		.first<{ value: string }>();
	if (done) return 0;
	let blanked = 0;
	let finished = true;
	for (const table of ["events", "sessions", "visitor_profiles"] as const) {
		let cursor = 0;
		let drained = false;
		for (let round = 0; round < SCRUB_ROUNDS; round++) {
			const { results } = await d1
				.prepare(
					`UPDATE ${table} SET fingerprint = NULL WHERE rowid IN (
					   SELECT rowid FROM ${table}
					   WHERE rowid > ?1 AND fingerprint IS NOT NULL AND fingerprint NOT LIKE ?2
					   ORDER BY rowid LIMIT ${SCRUB_CHUNK}) RETURNING rowid AS r`,
				)
				.bind(cursor, `${SALTED_FINGERPRINT_PREFIX}%`)
				.all<{ r: number }>();
			blanked += results.length;
			if (results.length < SCRUB_CHUNK) {
				drained = true;
				break;
			}
			cursor = results.reduce((max, row) => Math.max(max, row.r), cursor);
		}
		if (!drained) finished = false;
	}
	if (finished) {
		const stamp = new Date().toISOString();
		await d1
			.prepare(
				"INSERT INTO system_state (key, value, updated_at) VALUES (?1, ?2, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
			)
			.bind(LEGACY_FINGERPRINT_STATE, stamp)
			.run();
	}
	return blanked;
}
