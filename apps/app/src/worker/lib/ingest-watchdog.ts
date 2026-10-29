import { appUrl } from "./app-url";
import { type EmailBinding, sendEmail } from "./email";
import { isSelfHosted } from "./entitlement";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const WINDOW_MS = 2 * HOUR_MS;
const BASELINE_OFFSET_MS = 7 * DAY_MS;
/** Pageviews the same window last week must have had for silence now to count as an outage. */
export const BASELINE_MIN_PAGEVIEWS = 20;
/** An outage that outlives this is announced again. */
export const ALERT_COOLDOWN_MS = 12 * HOUR_MS;
const STATE_KEY = "ingest_alert";

export interface IngestWatchdogEnv {
	DB: D1Database;
	EMAIL?: EmailBinding;
	EMAIL_FROM?: string;
	SUPER_ADMIN_EMAIL?: string;
	APP_URL?: string;
	SELF_HOSTED?: string;
}

export type IngestWatchdogResult =
	| { action: "disabled" }
	| { action: "ok" | "quiet" | "deduped"; current: number; baseline: number }
	| { action: "alerted" | "recovered"; current: number; baseline: number; sent: boolean };

interface PageviewCounts {
	current: number;
	baseline: number;
}

/**
 * Pageviews across every site in the last 2 hours and in the same window 7 days
 * earlier. One correlated count per site keeps each probe on idx_events_site_type
 * instead of scanning the whole events table.
 */
async function countPageviews(d1: D1Database, nowMs: number): Promise<PageviewCounts> {
	const iso = (ms: number) => new Date(ms).toISOString();
	const perSite = (from: string, to: string) =>
		`SELECT COUNT(*) FROM events e WHERE e.site_id = s.id AND e.event_type = 'pageview' AND e.timestamp >= ${from} AND e.timestamp < ${to}`;
	const { results } = await d1
		.prepare(
			`SELECT COALESCE(SUM((${perSite("?1", "?2")})), 0) AS cur,
			        COALESCE(SUM((${perSite("?3", "?4")})), 0) AS base
			 FROM sites s`,
		)
		.bind(
			iso(nowMs - WINDOW_MS),
			iso(nowMs),
			iso(nowMs - BASELINE_OFFSET_MS - WINDOW_MS),
			iso(nowMs - BASELINE_OFFSET_MS),
		)
		.all<{ cur: number; base: number }>();
	const [row] = results;
	return { current: row?.cur ?? 0, baseline: row?.base ?? 0 };
}

async function readAlertedAt(d1: D1Database): Promise<number | null> {
	const { results } = await d1
		.prepare("SELECT value FROM system_state WHERE key = ?1")
		.bind(STATE_KEY)
		.all<{ value: string }>();
	const [row] = results;
	if (!row) return null;
	const at = Date.parse(row.value);
	return Number.isFinite(at) ? at : 0;
}

function alertEmail(env: IngestWatchdogEnv, { current, baseline }: PageviewCounts) {
	const url = appUrl(env);
	const subject = "RevKlik ALERT: no pageviews recorded in the last 2 hours";
	const text = `No pageview events were recorded across any site in the last 2 hours (${current}). The same window 7 days ago had ${baseline}. Tracking or ingest is probably broken.\n\n${url}`;
	const html = `<p><strong>No pageview events were recorded across any site in the last 2 hours</strong> (${current}).</p><p>The same window 7 days ago had ${baseline}. Tracking or ingest is probably broken.</p><p><a href="${url}">${url}</a></p>`;
	return { subject, text, html };
}

function recoveryEmail(env: IngestWatchdogEnv, { current, baseline }: PageviewCounts) {
	const url = appUrl(env);
	const subject = "RevKlik recovered: pageviews are being recorded again";
	const text = `Pageview ingest is back: ${current} pageviews in the last 2 hours (${baseline} in the same window 7 days ago).\n\n${url}`;
	const html = `<p><strong>Pageview ingest is back:</strong> ${current} pageviews in the last 2 hours (${baseline} in the same window 7 days ago).</p><p><a href="${url}">${url}</a></p>`;
	return { subject, text, html };
}

/**
 * Hourly canary on the hosted service: silence across all sites while last
 * week's same window was busy means tracking or ingest broke. Mails
 * SUPER_ADMIN_EMAIL once, repeats no sooner than ALERT_COOLDOWN_MS, and mails
 * again when pageviews return. The alert time lives in system_state; it is only
 * recorded (and the recovery only cleared) after the mail was accepted, so a
 * failed send is retried by the next run.
 */
export async function checkIngestHealth(
	env: IngestWatchdogEnv,
	nowMs = Date.now(),
): Promise<IngestWatchdogResult> {
	const to = env.SUPER_ADMIN_EMAIL?.trim();
	if (!to || isSelfHosted(env)) return { action: "disabled" };

	const counts = await countPageviews(env.DB, nowMs);
	const alertedAt = await readAlertedAt(env.DB);
	const send = (message: { subject: string; text: string; html: string }) =>
		sendEmail({ to, from: env.EMAIL_FROM, ...message }, env.EMAIL);

	if (counts.current > 0) {
		if (alertedAt === null) return { action: "ok", ...counts };
		const sent = await send(recoveryEmail(env, counts));
		if (sent) await env.DB.prepare("DELETE FROM system_state WHERE key = ?1").bind(STATE_KEY).run();
		return { action: "recovered", ...counts, sent };
	}

	if (counts.baseline < BASELINE_MIN_PAGEVIEWS) return { action: "quiet", ...counts };
	if (alertedAt !== null && nowMs - alertedAt < ALERT_COOLDOWN_MS) {
		return { action: "deduped", ...counts };
	}
	const sent = await send(alertEmail(env, counts));
	if (sent) {
		await env.DB.prepare(
			"INSERT INTO system_state (key, value, updated_at) VALUES (?1, ?2, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
		)
			.bind(STATE_KEY, new Date(nowMs).toISOString())
			.run();
	}
	return { action: "alerted", ...counts, sent };
}
