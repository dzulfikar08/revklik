import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import type { QueryScope } from "../queries/analytics";
import { ensureSiteCurrency } from "./currency-backfill";
import { loadUsdRates, normalizeCurrency } from "./fx";
import { clampTzOffset } from "./widget-live";

/** Site display currency, falling back to USD when unset or not convertible. */
export function displayCurrency(raw: unknown, rates: Record<string, number>): string {
	const code = normalizeCurrency(raw);
	return code && code in rates ? code : "USD";
}

/**
 * Query scope for one site: its revenue display currency and the caller's
 * `tz` query param (east-positive minutes). No tz param means UTC buckets.
 * A site whose currency was never inferred is settled inline on this read.
 */
export async function resolveQueryScope(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	env: { FX_USD_IDR?: string } | undefined,
	tzParam: string | undefined,
): Promise<QueryScope> {
	const rates = await loadUsdRates(db, env);
	const site = await db
		.selectFrom("sites")
		.select(["revenue_currency", "revenue_currency_source"])
		.where("id", "=", siteId)
		.executeTakeFirst();
	const stored = site?.revenue_currency ?? "USD";
	const currency = site
		? await ensureSiteCurrency(db, siteId, stored, site.revenue_currency_source)
		: stored;
	const tz = tzParam === undefined || tzParam === "" ? 0 : (clampTzOffset(Number(tzParam)) ?? 0);
	return {
		money: { currency: displayCurrency(currency, rates), rates },
		tzOffset: tz,
	};
}
