import { sql } from "kysely";
import { SESSION_GAP_CAP_SECONDS } from "./ingest";

/**
 * Average session duration over sessions with at least two events (those carry
 * `ended_at`). Uses `active_seconds`, which counts each gap between events up
 * to SESSION_GAP_CAP_SECONDS; a row written before that column falls back to
 * its whole span capped at the same limit, so an idle or abandoned tab never
 * reports hours.
 */
export const avgSessionSecondsSql = sql<
	number | null
>`AVG(CASE WHEN ended_at IS NOT NULL THEN COALESCE(active_seconds, MIN(${sql.lit(SESSION_GAP_CAP_SECONDS)}, (julianday(ended_at) - julianday(started_at)) * 86400)) END)`;
