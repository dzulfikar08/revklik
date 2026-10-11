import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { sql } from "../db";

/** Usage bucket key, UTC calendar month: "2026-10". */
export function usageMonth(now = new Date()): string {
	return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthStartIso(month: string): string {
	return `${month}-01T00:00:00Z`;
}

/**
 * Events ingested this month across every site the account owns. Reads the
 * account_usage counter; when the row is missing (first ingest of the month,
 * or pre-counter data) it seeds it from a one-off COUNT over events.
 */
export async function getAccountEventsUsed(
	db: Kysely<KlikapaDatabase>,
	userId: string,
	now = new Date(),
): Promise<number> {
	const month = usageMonth(now);
	const row = await db
		.selectFrom("account_usage")
		.select(["events"])
		.where("user_id", "=", userId)
		.where("month", "=", month)
		.executeTakeFirst();
	if (row) return Number(row.events);

	const counted = await db
		.selectFrom("events")
		.select(({ fn }) => fn.count<number>("id").as("cnt"))
		.where("site_id", "in", db.selectFrom("sites").select("id").where("user_id", "=", userId))
		.where("timestamp", ">=", monthStartIso(month))
		.executeTakeFirst();
	const events = Number(counted?.cnt ?? 0);
	await db
		.insertInto("account_usage")
		.values({ user_id: userId, month, events })
		.onConflict((oc) => oc.columns(["user_id", "month"]).doNothing())
		.execute();
	return events;
}

/** Upsert that adds `count` to the account's counter for the current month. */
export function accountUsageIncrement(
	db: Kysely<KlikapaDatabase>,
	userId: string,
	count: number,
	now = new Date(),
) {
	return db
		.insertInto("account_usage")
		.values({ user_id: userId, month: usageMonth(now), events: count })
		.onConflict((oc) =>
			oc.columns(["user_id", "month"]).doUpdateSet({ events: sql`events + ${count}` }),
		);
}
