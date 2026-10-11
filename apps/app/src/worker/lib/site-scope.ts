import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import type { QueryScope } from "../queries/analytics";
import { normalizeCurrency, usdRates } from "./fx";
import { clampTzOffset } from "./widget-live";

/** Site display currency, falling back to USD when unset or not convertible. */
export function displayCurrency(raw: unknown, rates: Record<string, number>): string {
	const code = normalizeCurrency(raw);
	return code && code in rates ? code : "USD";
}

/**
 * Query scope for one site: its revenue display currency and the caller's
 * `tz` query param (east-positive minutes). No tz param means UTC buckets.
 */
export async function resolveQueryScope(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	env: { FX_USD_IDR?: string } | undefined,
	tzParam: string | undefined,
): Promise<QueryScope> {
	const rates = usdRates(env);
	const site = await db
		.selectFrom("sites")
		.select(["revenue_currency"])
		.where("id", "=", siteId)
		.executeTakeFirst();
	const tz = tzParam === undefined || tzParam === "" ? 0 : (clampTzOffset(Number(tzParam)) ?? 0);
	return {
		money: { currency: displayCurrency(site?.revenue_currency, rates), rates },
		tzOffset: tz,
	};
}
