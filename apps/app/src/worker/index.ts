import { createApp } from "./app";
import { createDb } from "./db";
import { backupDatabase } from "./backup";
import { syncAllAppStoreConnect } from "./lib/appstoreconnect";
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
			return;
		}
		if (controller.cron === "0 18 * * *") {
			// App Store Connect daily sync (reports land ~8am Pacific).
			if (env.DB) await syncAllAppStoreConnect(createDb(env.DB));
			return;
		}
	},
} satisfies ExportedHandler<Bindings>;
