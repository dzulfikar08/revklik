import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { sql } from "../db";

/** Sites inspected per cron run; each costs one indexed revenue scan. */
export const CURRENCY_BACKFILL_BATCH = 500;

/**
 * Existing sites (revenue_currency_source NULL) take the currency most of their
 * revenue arrived in, USD when they have none, and are marked 'auto'. Runs off
 * the request path from the daily cron; returns the number of sites settled.
 */
export async function inferSiteCurrencies(
	db: Kysely<KlikapaDatabase>,
	limit = CURRENCY_BACKFILL_BATCH,
): Promise<number> {
	const sites = await db
		.selectFrom("sites")
		.select(["id", "revenue_currency"])
		.where("revenue_currency_source", "is", null)
		.limit(limit)
		.execute();
	for (const site of sites) {
		const top = await db
			.selectFrom("events")
			.select([
				sql<string>`UPPER(COALESCE(NULLIF(currency, ''), 'USD'))`.as("cur"),
				({ fn }) => fn.countAll<number>().as("n"),
			])
			.where("site_id", "=", site.id)
			.where("revenue", ">", 0)
			.groupBy(sql`UPPER(COALESCE(NULLIF(currency, ''), 'USD'))`)
			.orderBy("n", "desc")
			.limit(1)
			.executeTakeFirst();
		await db
			.updateTable("sites")
			.set({
				revenue_currency: site.revenue_currency === "USD" ? (top?.cur ?? "USD") : undefined,
				revenue_currency_source: "auto",
			})
			.where("id", "=", site.id)
			.where("revenue_currency_source", "is", null)
			.execute();
	}
	return sites.length;
}
