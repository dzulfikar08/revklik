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

/**
 * Delete rows matching `where` in PURGE_CHUNK slices, one table per D1 batch
 * round, until each table runs dry or maxRounds is hit. Returns rows deleted.
 */
export async function deleteInChunks(
	d1: D1Database,
	targets: ReadonlyArray<{ table: string; where: string; params: unknown[] }>,
	maxRounds = 1_000,
): Promise<number> {
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
	return deleted;
}

/** Remove every row belonging to a site (the sites row itself is left to the caller). */
export function purgeSiteRows(d1: D1Database, siteId: string): Promise<number> {
	return deleteInChunks(
		d1,
		SITE_SCOPED_TABLES.map((table) => ({ table, where: "site_id = ?", params: [siteId] })),
	);
}

/**
 * Hard-delete raw analytics older than `days`. Disabled (returns 0) unless
 * RETENTION_HARD_DELETE_DAYS is set to a positive number.
 */
export async function purgeExpiredRows(
	d1: D1Database,
	daysSetting: string | undefined,
	now = Date.now(),
	maxRounds = 200,
): Promise<number> {
	const days = Number(daysSetting);
	if (!daysSetting || !Number.isFinite(days) || days <= 0) return 0;
	const cutoff = new Date(now - days * 86_400_000).toISOString();
	return deleteInChunks(
		d1,
		RETENTION_TABLES.map(({ table, column }) => ({
			table,
			where: `${column} < ?`,
			params: [cutoff],
		})),
		maxRounds,
	);
}
