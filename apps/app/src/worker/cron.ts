import { backupDatabase } from "./backup";
import { createDb } from "./db";
import { syncAllAppStoreConnect } from "./lib/appstoreconnect";
import { reclassifyRecentBots } from "./lib/bot-reclassify";
import { type CronJob, type JobOutcome, runJobs } from "./lib/cron";
import { inferSiteCurrencies } from "./lib/currency-backfill";
import { isSelfHosted } from "./lib/entitlement";
import { refreshFxRates } from "./lib/fx";
import { checkIngestHealth } from "./lib/ingest-watchdog";
import { purgeExpiredRows, scrubLegacyFingerprints } from "./lib/purge";
import { pruneOutbox, runPushCron } from "./lib/push";
import { syncAllPolar } from "./lib/polar-sync";
import { carryOverPakasirOrders } from "./migrations";
import type { Bindings } from "./types";

/** 03:00 UTC: the encrypted database snapshot, alone so it owns the invocation's budget. */
export const CRON_BACKUP = "0 3 * * *";
/** 03:30 UTC: nightly upkeep that must run even when the backup failed. */
export const CRON_MAINTENANCE = "30 3 * * *";
export const CRON_HOURLY = "15 * * * *";
export const CRON_FREQUENT = "*/5 * * * *";
/** 18:00 UTC: App Store Connect reports land ~8am Pacific. */
export const CRON_APP_STORE = "0 18 * * *";

/**
 * The jobs one trigger runs, in order. Each job fails on its own: a throw is
 * logged, mailed to SUPER_ADMIN_EMAIL (see lib/cron.ts) and the next job runs.
 */
export function jobsFor(cron: string, env: Bindings): CronJob[] {
	const d1 = env.DB;
	if (!d1) return [];
	switch (cron) {
		case CRON_BACKUP:
			return [["backup", () => backupDatabase(env)]];
		case CRON_MAINTENANCE:
			return [
				// Pakasir orders are RevKlik's own subscription billing: hosted only.
				["pakasir-carry-over", async () => !isSelfHosted(env) && carryOverPakasirOrders(d1)],
				["fx-refresh", () => refreshFxRates(createDb(d1))],
				["currency-backfill", () => inferSiteCurrencies(createDb(d1))],
				[
					"retention-purge",
					async () => {
						const purged = await purgeExpiredRows(d1, {
							selfHosted: isSelfHosted(env),
							hardDeleteDays: env.RETENTION_HARD_DELETE_DAYS,
						});
						if (purged > 0) console.log(`Retention purge: ${purged} rows deleted`);
					},
				],
				["fingerprint-scrub", () => scrubLegacyFingerprints(d1)],
				["push-outbox-prune", () => pruneOutbox(env)],
			];
		case CRON_FREQUENT:
			// Sale alerts: retry failed sends, then read Expo receipts and drop dead devices.
			return [["push", () => runPushCron(env)]];
		case CRON_HOURLY:
			// Sessions that grew into bot-shaped bursts since the last pass, the ingest canary
			// (mails SUPER_ADMIN_EMAIL when pageviews stop), then the last two weeks of Polar
			// orders for sites with a saved token. Polar runs last on a capped budget so it
			// cannot starve the others of D1's per-invocation query limit.
			return [
				["bot-reclassify", () => reclassifyRecentBots(d1)],
				["ingest-health", () => checkIngestHealth(env)],
				["polar-sync", () => syncAllPolar(createDb(d1), env)],
			];
		case CRON_APP_STORE:
			return [["app-store-sync", () => syncAllAppStoreConnect(createDb(d1))]];
		default:
			return [];
	}
}

export function runScheduled(cron: string, env: Bindings): Promise<JobOutcome[]> {
	return runJobs(env, cron, jobsFor(cron, env));
}
