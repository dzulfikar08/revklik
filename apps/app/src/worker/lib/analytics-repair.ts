/**
 * Repairs for analytics rows written by two since-fixed bugs; run through
 * `bun scripts/repair-analytics.ts` (dry run by default). Every UPDATE is
 * guarded by the broken state, so running one twice changes nothing.
 */
export interface AnalyticsRepair {
	name: string;
	description: string;
	table: string;
	/** WHERE clause (without the keyword) selecting only the broken rows. */
	where: string;
	/** The UPDATE statement; carries the same guard as `where`. */
	update: string;
	/** SELECT list showing a row as stored and as it would be repaired. */
	sample: string;
}

/**
 * OneDollarStats imports stored `2026-04-30 00:00:00T12:00:00Z`, which SQLite's
 * date()/strftime() read as NULL, so the rows dropped out of every daily bucket. The GLOB
 * stays short: D1 refuses LIKE/GLOB patterns over 50 bytes ("pattern too complex").
 */
const MALFORMED_ODS_TIMESTAMP = `length(timestamp) = 29 AND timestamp GLOB '????-??-?? 00:00:00T*' AND json_valid(props) AND json_extract(props, '$.source') = 'onedollarstats_import'`;

const REPAIRED_ODS_TIMESTAMP = `substr(timestamp, 1, 10) || substr(timestamp, 20)`;

/** Sessions rows a profile really has; total_sessions used to be bumped per batch, not per session. */
const REAL_SESSIONS = `(SELECT COUNT(*) FROM sessions s WHERE s.site_id = visitor_profiles.site_id AND s.visitor_id = visitor_profiles.visitor_id)`;

export const ANALYTICS_REPAIRS: readonly AnalyticsRepair[] = [
	{
		name: "ods-timestamps",
		description: "OneDollarStats pageviews with a malformed timestamp",
		table: "events",
		where: MALFORMED_ODS_TIMESTAMP,
		update: `UPDATE events SET timestamp = ${REPAIRED_ODS_TIMESTAMP} WHERE ${MALFORMED_ODS_TIMESTAMP};`,
		sample: `id, timestamp AS stored, ${REPAIRED_ODS_TIMESTAMP} AS repaired`,
	},
	{
		name: "total-sessions",
		description:
			"visitor profiles whose total_sessions exceeds their real session count (lowered, never raised)",
		table: "visitor_profiles",
		where: `total_sessions > ${REAL_SESSIONS}`,
		update: `UPDATE visitor_profiles SET total_sessions = ${REAL_SESSIONS} WHERE total_sessions > ${REAL_SESSIONS};`,
		sample: `visitor_id, total_sessions AS stored, ${REAL_SESSIONS} AS repaired`,
	},
];
