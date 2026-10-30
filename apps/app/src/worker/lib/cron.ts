import { appUrl } from "./app-url";
import { type EmailBinding, sendEmail } from "./email";
import { isSelfHosted } from "./entitlement";

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
const escapeHtml = (text: string): string => text.replace(/[&<>]/g, (ch) => HTML_ESCAPES[ch] ?? ch);

/** A job that keeps failing mails the admin at most this often. */
export const FAILURE_MAIL_COOLDOWN_MS = 12 * 3_600_000;

export interface JobOutcome {
	name: string;
	ok: boolean;
	ms: number;
	error?: string;
}

export interface CronEnv {
	DB?: D1Database;
	EMAIL?: EmailBinding;
	EMAIL_FROM?: string;
	SUPER_ADMIN_EMAIL?: string;
	APP_URL?: string;
	SELF_HOSTED?: string;
}

export type CronJob = readonly [name: string, run: () => Promise<unknown>];

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Run one job: a throw is recorded, logged with its name and never propagates. */
export async function runJob(name: string, run: () => Promise<unknown>): Promise<JobOutcome> {
	const startedAt = Date.now();
	try {
		await run();
		return { name, ok: true, ms: Date.now() - startedAt };
	} catch (err) {
		console.error(`[cron] ${name} failed:`, err);
		return { name, ok: false, ms: Date.now() - startedAt, error: errorText(err) };
	}
}

const failureKey = (name: string) => `cron_failure:${name}`;

async function lastMailedAt(d1: D1Database, name: string): Promise<number> {
	const row = await d1
		.prepare("SELECT value FROM system_state WHERE key = ?1")
		.bind(failureKey(name))
		.first<{ value: string }>();
	const at = row ? Date.parse(row.value) : 0;
	return Number.isFinite(at) ? at : 0;
}

/**
 * Mail SUPER_ADMIN_EMAIL about failed jobs, one message per run, skipping jobs
 * already mailed inside the cooldown. The mail time is recorded only after the
 * mail was accepted, so an undelivered alert is retried by the next failure.
 * Never throws: reporting must not be able to fail a cron run.
 */
export async function reportFailures(
	env: CronEnv,
	cron: string,
	outcomes: JobOutcome[],
	nowMs = Date.now(),
): Promise<void> {
	const failed = outcomes.filter((o) => !o.ok);
	const to = env.SUPER_ADMIN_EMAIL?.trim();
	if (!failed.length || !to || !env.DB || isSelfHosted(env)) return;
	try {
		const due: JobOutcome[] = [];
		for (const job of failed) {
			if (nowMs - (await lastMailedAt(env.DB, job.name)) >= FAILURE_MAIL_COOLDOWN_MS) due.push(job);
		}
		if (!due.length) return;
		const lines = due.map((o) => `${o.name}: ${o.error ?? "unknown error"}`);
		const url = appUrl(env);
		const sent = await sendEmail(
			{
				to,
				from: env.EMAIL_FROM,
				subject: `RevKlik cron failed: ${due.map((o) => o.name).join(", ")}`,
				text: `Scheduled run "${cron}" had failing jobs. The other jobs of the run were not affected.\n\n${lines.join("\n")}\n\n${url}`,
				html: `<p>Scheduled run <code>${cron}</code> had failing jobs. The other jobs of the run were not affected.</p><ul>${due
					.map((o) => `<li><code>${o.name}</code>: ${escapeHtml(o.error ?? "unknown error")}</li>`)
					.join("")}</ul><p><a href="${url}">${url}</a></p>`,
			},
			env.EMAIL,
		);
		if (!sent) return;
		const stamp = new Date(nowMs).toISOString();
		for (const job of due) {
			await env.DB.prepare(
				"INSERT INTO system_state (key, value, updated_at) VALUES (?1, ?2, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
			)
				.bind(failureKey(job.name), stamp)
				.run();
		}
	} catch (err) {
		console.error("[cron] failure report skipped:", err);
	}
}

/** Run jobs one after another; each fails on its own, then failures are reported once. */
export async function runJobs(
	env: CronEnv,
	cron: string,
	jobs: readonly CronJob[],
): Promise<JobOutcome[]> {
	const outcomes: JobOutcome[] = [];
	for (const [name, run] of jobs) outcomes.push(await runJob(name, run));
	await reportFailures(env, cron, outcomes);
	return outcomes;
}
