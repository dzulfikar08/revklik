import { createApp } from "./app";
import { createDb } from "./db";
import { backupDatabase } from "./backup";
import { syncAllAppStoreConnect } from "./lib/appstoreconnect";
import { reclassifyRecentBots } from "./lib/bot-reclassify";
import { inferSiteCurrencies } from "./lib/currency-backfill";
import { isSelfHosted } from "./lib/entitlement";
import { refreshFxRates } from "./lib/fx";
import { checkIngestHealth } from "./lib/ingest-watchdog";
import { pruneOutbox, runPushCron } from "./lib/push";
import { purgeExpiredRows } from "./lib/purge";
import { carryOverPakasirOrders } from "./migrations";
import type { Bindings } from "./types";

const app = createApp();

export default {
	async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
		const { pathname } = new URL(request.url);
		if (pathname.startsWith("/api/")) return app.fetch(request, env, ctx);
		return env.ASSETS.fetch(request);
	},
	async scheduled(controller: ScheduledController, env: Bindings, _ctx: ExecutionContext) {
		if (controller.cron === "0 3 * * *") {
			await backupDatabase(env);
			// Runs after the dump; a no-op unless RETENTION_HARD_DELETE_DAYS is set.
			if (env.DB) {
				// Pakasir orders are RevKlik's own subscription billing: hosted only.
				if (!isSelfHosted(env)) await carryOverPakasirOrders(env.DB);
				await refreshFxRates(createDb(env.DB)).catch((err) =>
					console.error("FX refresh failed:", err),
				);
				await inferSiteCurrencies(createDb(env.DB)).catch((err) =>
					console.error("Currency backfill failed:", err),
				);
				const purged = await purgeExpiredRows(env.DB, env.RETENTION_HARD_DELETE_DAYS);
				if (purged > 0) console.log(`Retention purge: ${purged} rows deleted`);
				await pruneOutbox(env).catch((err) => console.error("Push outbox prune failed:", err));
			}
			return;
		}
		if (controller.cron === "*/5 * * * *") {
			// Sale alerts: retry failed sends, then read Expo receipts and drop dead devices.
			if (env.DB) await runPushCron(env);
			return;
		}
		if (controller.cron === "15 * * * *") {
			// Hourly: sessions that grew into bot-shaped bursts since the last pass,
			// then the ingest canary (mails SUPER_ADMIN_EMAIL when pageviews stop).
			if (env.DB) {
				await reclassifyRecentBots(env.DB);
				await checkIngestHealth(env).catch((err) =>
					console.error("Ingest health check failed:", err),
				);
			}
			return;
		}
		if (controller.cron === "0 18 * * *") {
			// App Store Connect daily sync (reports land ~8am Pacific).
			if (env.DB) await syncAllAppStoreConnect(createDb(env.DB));
			return;
		}
	},
} satisfies ExportedHandler<Bindings>;
