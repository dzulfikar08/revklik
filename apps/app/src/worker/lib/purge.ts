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

/** Raw tables that the retention purge trims, with their time column. */
export const RETENTION_TABLES = [
	{ table: "events", column: "timestamp" },
	{ table: "crawler_hits", column: "timestamp" },
	{ table: "session_recordings", column: "started_at" },
	{ table: "heatmap_clicks", column: "timestamp" },
	{ table: "heatmap_scrolls", column: "timestamp" },
] as const;

const IDENT_RE = /^[a-z_]+$/;

/** Shortest hard-delete horizon accepted: below the longest plan retention would cut paid history. */
export const MIN_HARD_DELETE_DAYS = 90;

export interface ChunkedDeleteResult {
	deleted: number;
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
	for (let round = 0; round < maxRounds && pending.length > 0; round++) {
		const stmts = pending.map((t) =>
			d1
				.prepare(
					`DELETE FROM ${t.table} WHERE rowid IN (SELECT rowid FROM ${t.table} WHERE ${t.where} LIMIT ${PURGE_CHUNK}) RETURNING 1 AS gone`,
				)
				.bind(...t.params),
		);
		const results = (await d1.batch(stmts)) as Array<{ results?: unknown[] }>;
		const next: typeof pending = [];
		pending.forEach((t, i) => {
			const n = results[i]?.results?.length ?? 0;
			deleted += n;
			if (n >= PURGE_CHUNK) next.push(t);
		});
		pending = next;
	}
	return { deleted, unfinished: pending.map((t) => t.table) };
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
 * Hard-delete raw analytics older than `days`, site by site so every slice
 * rides the (site_id, time) indexes. Disabled (0) unless
 * RETENTION_HARD_DELETE_DAYS is set; values under MIN_HARD_DELETE_DAYS are refused.
 */
export async function purgeExpiredRows(
	d1: D1Database,
	daysSetting: string | undefined,
	now = Date.now(),
	maxRoundsPerSite = 50,
): Promise<number> {
	const days = Number(daysSetting);
	if (!daysSetting || !Number.isFinite(days)) return 0;
	if (days < MIN_HARD_DELETE_DAYS) {
		console.error(
			`RETENTION_HARD_DELETE_DAYS=${daysSetting} refused (minimum ${MIN_HARD_DELETE_DAYS})`,
		);
		return 0;
	}
	const cutoff = new Date(now - days * 86_400_000).toISOString();
	const sites = await d1.prepare("SELECT id FROM sites").all<{ id: string }>();
	let deleted = 0;
	for (const { id } of sites.results ?? []) {
		const result = await deleteInChunks(
			d1,
			RETENTION_TABLES.map(({ table, column }) => ({
				table,
				where: `site_id = ? AND ${column} < ?`,
				params: [id, cutoff],
			})),
			maxRoundsPerSite,
		);
		deleted += result.deleted;
	}
	return deleted;
}
