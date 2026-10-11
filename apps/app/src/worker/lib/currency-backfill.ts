import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { sql } from "../db";

/** Sites inspected per cron run. */
export const CURRENCY_BACKFILL_BATCH = 500;
/** Most recent revenue rows a single inference looks at. */
export const CURRENCY_SAMPLE_ROWS = 5_000;

/** Most common currency among the site's latest revenue rows; USD when it has none. */
async function dominantCurrency(db: Kysely<KlikapaDatabase>, siteId: string): Promise<string> {
	const { rows } = await sql<{ cur: string }>`
		SELECT cur FROM (
			SELECT UPPER(COALESCE(NULLIF(currency, ''), 'USD')) AS cur
			FROM events
			WHERE site_id = ${siteId} AND revenue > 0
			ORDER BY timestamp DESC
			LIMIT ${CURRENCY_SAMPLE_ROWS}
		)
		GROUP BY cur ORDER BY COUNT(*) DESC LIMIT 1`.execute(db);
	return rows[0]?.cur ?? "USD";
}

/**
 * Settle one not-yet-inferred site (revenue_currency_source NULL): a site still
 * on the default USD takes its dominant currency; either way it is marked
 * 'auto'. Returns the currency the site now displays.
 */
export async function inferSiteCurrency(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	current: string,
): Promise<string> {
	const next = current === "USD" ? await dominantCurrency(db, siteId) : current;
	await db
		.updateTable("sites")
		.set({ revenue_currency: next, revenue_currency_source: "auto" })
		.where("id", "=", siteId)
		.where("revenue_currency_source", "is", null)
		.execute();
	return next;
}

// Settled or in-flight inferences: parallel readers of one site share a promise.
const inflight = new Map<string, Promise<string>>();

/**
 * Read-path variant: infers inline the first time a site is read, at most once
 * per isolate, and fails open by returning the stored currency on any error.
 */
export async function ensureSiteCurrency(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	current: string,
	source: string | null | undefined,
): Promise<string> {
	if (source !== null && source !== undefined) return current;
	let pending = inflight.get(siteId);
	if (!pending) {
		pending = inferSiteCurrency(db, siteId, current).catch((err) => {
			console.error(`[currency] site ${siteId}: lazy inference failed, keeping ${current}:`, err);
			return current;
		});
		inflight.set(siteId, pending);
	}
	return pending;
}

/** Nightly sweep over sites the read path has not touched yet. */
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
		await inferSiteCurrency(db, site.id, site.revenue_currency ?? "USD");
	}
	return sites.length;
}
