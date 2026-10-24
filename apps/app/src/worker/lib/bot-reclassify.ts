import { classifySession, type SessionFeatures, PAGEVIEW_BURST_GAP_SECONDS } from "./bot-detection";
import { SESSION_GAP_CAP_SECONDS } from "./ingest";

/** D1 rejects statements binding more than 100 parameters; ids go out in windows. */
const ID_CHUNK = 50;
const EPOCH_ISO = "1970-01-01T00:00:00.000Z";

export interface ReclassifyOptions {
	siteId: string;
	/** Only sessions started at or after this instant; default: every session. */
	sinceIso?: string;
	/** Rebuild `active_seconds` from the events (needed once for rows written before the column). */
	recomputeDurations?: boolean;
	/** Judge and report, write nothing. */
	dryRun?: boolean;
}

export interface ReclassifyResult {
	sessions: number;
	bots: number;
	/** Sessions whose verdict changed in this run. */
	flagged: number;
	unflagged: number;
	byReason: Record<string, number>;
}

interface SessionRow {
	id: string;
	city: string | null;
	os: string | null;
	device_type: string | null;
	as_org: string | null;
	is_bot: number;
	bot_reason: string | null;
}

interface EventAgg {
	session_id: string;
	n: number;
	pv: number;
	cl: number;
	span: number | null;
}

function chunks<T>(items: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}

/**
 * Re-judge every session of a site against the current rules and make events
 * and visitor profiles agree with the verdict. Idempotent: rerun it after any
 * change to lib/bot-detection.ts. Reads D1 directly (the Kysely bot filter
 * would hide the very rows being judged).
 */
export async function reclassifyBots(
	d1: D1Database,
	opts: ReclassifyOptions,
): Promise<ReclassifyResult> {
	const { siteId } = opts;
	const since = opts.sinceIso ?? EPOCH_ISO;
	const inWindow = "(SELECT id FROM sessions WHERE site_id = ?1 AND started_at >= ?2)";

	const [sessionRows, aggRows, scrollRows, burstRows] = await Promise.all([
		d1
			.prepare(
				"SELECT id, city, os, device_type, as_org, is_bot, bot_reason FROM sessions WHERE site_id = ?1 AND started_at >= ?2",
			)
			.bind(siteId, since)
			.all<SessionRow>(),
		d1
			.prepare(
				`SELECT session_id, COUNT(*) AS n,
				        SUM(CASE WHEN event_type = 'pageview' THEN 1 ELSE 0 END) AS pv,
				        SUM(CASE WHEN name = 'click' THEN 1 ELSE 0 END) AS cl,
				        (julianday(MAX(timestamp)) - julianday(MIN(timestamp))) * 86400 AS span
				 FROM events WHERE site_id = ?1 AND session_id IN ${inWindow} GROUP BY session_id`,
			)
			.bind(siteId, since)
			.all<EventAgg>(),
		d1
			.prepare(
				`SELECT session_id, MAX(c) AS m FROM (
				   SELECT session_id, timestamp, COUNT(*) AS c FROM events
				   WHERE site_id = ?1 AND name = 'scroll' AND session_id IN ${inWindow}
				   GROUP BY session_id, timestamp
				 ) GROUP BY session_id`,
			)
			.bind(siteId, since)
			.all<{ session_id: string; m: number }>(),
		d1
			.prepare(
				`SELECT session_id, COUNT(*) AS q FROM (
				   SELECT session_id,
				          (julianday(timestamp) - julianday(LAG(timestamp) OVER (PARTITION BY session_id ORDER BY timestamp))) * 86400 AS gap
				   FROM events WHERE site_id = ?1 AND event_type = 'pageview' AND session_id IN ${inWindow}
				 ) WHERE gap < ${PAGEVIEW_BURST_GAP_SECONDS} GROUP BY session_id`,
			)
			.bind(siteId, since)
			.all<{ session_id: string; q: number }>(),
	]);

	const agg = new Map(aggRows.results.map((r) => [r.session_id, r]));
	const scroll = new Map(scrollRows.results.map((r) => [r.session_id, Number(r.m)]));
	const burst = new Map(burstRows.results.map((r) => [r.session_id, Number(r.q)]));

	const result: ReclassifyResult = {
		sessions: sessionRows.results.length,
		bots: 0,
		flagged: 0,
		unflagged: 0,
		byReason: {},
	};
	const toFlag = new Map<string, string[]>();
	const toClear: string[] = [];

	for (const row of sessionRows.results) {
		const a = agg.get(row.id);
		const features: SessionFeatures = {
			city: row.city,
			os: row.os,
			deviceType: row.device_type,
			asOrg: row.as_org,
			events: Number(a?.n ?? 0),
			pageviews: Number(a?.pv ?? 0),
			clicks: Number(a?.cl ?? 0),
			spanSeconds: a?.span ?? Number.POSITIVE_INFINITY,
			maxScrollSameMs: scroll.get(row.id) ?? 0,
			quickPageviewGaps: burst.get(row.id) ?? 0,
			existingReason: row.is_bot ? row.bot_reason : null,
		};
		const reason = classifySession(features);
		if (reason) {
			result.bots++;
			result.byReason[reason] = (result.byReason[reason] ?? 0) + 1;
		}
		if (reason && (!row.is_bot || row.bot_reason !== reason)) {
			if (!row.is_bot) result.flagged++;
			const ids = toFlag.get(reason) ?? [];
			ids.push(row.id);
			toFlag.set(reason, ids);
		} else if (!reason && row.is_bot) {
			result.unflagged++;
			toClear.push(row.id);
		}
	}

	if (opts.dryRun) return result;

	const statements: D1PreparedStatement[] = [];
	for (const [reason, ids] of toFlag) {
		for (const part of chunks(ids, ID_CHUNK)) {
			const marks = part.map((_, i) => `?${i + 3}`).join(",");
			statements.push(
				d1
					.prepare(
						`UPDATE sessions SET is_bot = 1, bot_reason = ?1 WHERE site_id = ?2 AND id IN (${marks})`,
					)
					.bind(reason, siteId, ...part),
			);
		}
	}
	for (const part of chunks(toClear, ID_CHUNK)) {
		const marks = part.map((_, i) => `?${i + 2}`).join(",");
		statements.push(
			d1
				.prepare(
					`UPDATE sessions SET is_bot = 0, bot_reason = NULL WHERE site_id = ?1 AND id IN (${marks})`,
				)
				.bind(siteId, ...part),
		);
	}

	// D1 caps the CPU of one statement batch, so each phase runs as its own batch.
	if (statements.length > 0) await d1.batch(statements);

	// Events and profiles follow their session's verdict. IN (subquery) is built
	// once per statement; a per-row EXISTS would rescan sessions for every profile.
	await d1.batch([
		d1
			.prepare(
				`UPDATE events SET is_bot = 1 WHERE site_id = ?1 AND is_bot = 0 AND session_id IN
				 (SELECT id FROM sessions WHERE site_id = ?1 AND is_bot = 1 AND started_at >= ?2)`,
			)
			.bind(siteId, since),
		d1
			.prepare(
				`UPDATE events SET is_bot = 0 WHERE site_id = ?1 AND is_bot = 1 AND session_id IN
				 (SELECT id FROM sessions WHERE site_id = ?1 AND is_bot = 0 AND started_at >= ?2)`,
			)
			.bind(siteId, since),
	]);
	await d1.batch([
		d1
			.prepare(
				`UPDATE visitor_profiles SET is_bot = 1
				 WHERE site_id = ?1 AND is_bot = 0 AND last_seen >= ?2
				   AND visitor_id IN (SELECT visitor_id FROM sessions WHERE site_id = ?1 AND is_bot = 1)
				   AND visitor_id NOT IN (SELECT visitor_id FROM sessions WHERE site_id = ?1 AND is_bot = 0)`,
			)
			.bind(siteId, since),
		d1
			.prepare(
				`UPDATE visitor_profiles SET is_bot = 0
				 WHERE site_id = ?1 AND is_bot = 1 AND last_seen >= ?2
				   AND visitor_id IN (SELECT visitor_id FROM sessions WHERE site_id = ?1 AND is_bot = 0)`,
			)
			.bind(siteId, since),
	]);

	if (opts.recomputeDurations) {
		await d1
			.prepare(
				`UPDATE sessions SET active_seconds = COALESCE(d.active, 0)
				 FROM (
				   SELECT session_id, CAST(ROUND(SUM(MIN(${SESSION_GAP_CAP_SECONDS}, MAX(0, gap)))) AS INTEGER) AS active
				   FROM (
				     SELECT session_id,
				            (julianday(timestamp) - julianday(LAG(timestamp) OVER (PARTITION BY session_id ORDER BY timestamp))) * 86400 AS gap
				     FROM events WHERE site_id = ?1 AND session_id IN ${inWindow}
				   ) GROUP BY session_id
				 ) AS d
				 WHERE sessions.site_id = ?1 AND sessions.id = d.session_id AND sessions.started_at >= ?2`,
			)
			.bind(siteId, since)
			.run();
	}
	return result;
}

/** Window the scheduled run re-judges: long enough to catch sessions that grew since the last pass. */
const RECENT_WINDOW_HOURS = 36;

/** Re-judge the recent sessions of every site that had traffic in the window. */
export async function reclassifyRecentBots(
	d1: D1Database,
	nowMs = Date.now(),
): Promise<{ sites: number; flagged: number }> {
	const sinceIso = new Date(nowMs - RECENT_WINDOW_HOURS * 3_600_000).toISOString();
	const { results } = await d1
		.prepare("SELECT DISTINCT site_id FROM sessions WHERE started_at >= ?1")
		.bind(sinceIso)
		.all<{ site_id: string }>();
	let flagged = 0;
	for (const { site_id } of results) {
		try {
			flagged += (await reclassifyBots(d1, { siteId: site_id, sinceIso })).flagged;
		} catch (err) {
			console.error(`[bot-reclassify] site ${site_id} failed:`, err);
		}
	}
	return { sites: results.length, flagged };
}
