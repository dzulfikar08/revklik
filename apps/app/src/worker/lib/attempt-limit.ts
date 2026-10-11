import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { sql } from "../db";

/**
 * Fixed-window attempt counter in D1 (login_attempts), shared by every
 * isolate — the per-isolate in-memory limiter cannot stop a distributed
 * password guesser.
 */
export interface AttemptPolicy {
	max: number;
	windowMs: number;
}

export const LOGIN_POLICY: AttemptPolicy = { max: 10, windowMs: 15 * 60_000 };
export const RESET_REQUEST_POLICY: AttemptPolicy = { max: 5, windowMs: 60 * 60_000 };

export async function isLimited(
	db: Kysely<KlikapaDatabase>,
	key: string,
	policy: AttemptPolicy,
	now = Date.now(),
): Promise<boolean> {
	const row = await db
		.selectFrom("login_attempts")
		.select(["count", "window_start"])
		.where("key", "=", key)
		.executeTakeFirst();
	if (!row) return false;
	if (now - new Date(row.window_start).getTime() > policy.windowMs) return false;
	return row.count >= policy.max;
}

/** Count one attempt; a stale window restarts at 1. */
export async function recordAttempt(
	db: Kysely<KlikapaDatabase>,
	key: string,
	policy: AttemptPolicy,
	now = Date.now(),
): Promise<void> {
	const nowIso = new Date(now).toISOString();
	const windowFloor = new Date(now - policy.windowMs).toISOString();
	await db
		.insertInto("login_attempts")
		.values({ key, count: 1, window_start: nowIso })
		.onConflict((oc) =>
			oc.column("key").doUpdateSet({
				count: sql`CASE WHEN window_start < ${windowFloor} THEN 1 ELSE count + 1 END`,
				window_start: sql`CASE WHEN window_start < ${windowFloor} THEN ${nowIso} ELSE window_start END`,
			}),
		)
		.execute();
}

export async function clearAttempts(db: Kysely<KlikapaDatabase>, key: string): Promise<void> {
	await db.deleteFrom("login_attempts").where("key", "=", key).execute();
}
