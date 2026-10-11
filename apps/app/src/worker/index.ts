import { createApp } from "./app";
import { createDb } from "./db";
import { backupDatabase } from "./backup";
import { syncAllAppStoreConnect } from "./lib/appstoreconnect";
import { inferSiteCurrencies } from "./lib/currency-backfill";
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
				await carryOverPakasirOrders(env.DB);
				await inferSiteCurrencies(createDb(env.DB)).catch((err) =>
					console.error("Currency backfill failed:", err),
				);
				const purged = await purgeExpiredRows(env.DB, env.RETENTION_HARD_DELETE_DAYS);
				if (purged > 0) console.log(`Retention purge: ${purged} rows deleted`);
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
