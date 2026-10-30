import { createApp } from "./app";
import { runScheduled } from "./cron";
import type { Bindings } from "./types";

const app = createApp();

export default {
	async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
		const { pathname } = new URL(request.url);
		if (pathname.startsWith("/api/")) return app.fetch(request, env, ctx);
		return env.ASSETS.fetch(request);
	},
	async scheduled(controller: ScheduledController, env: Bindings, _ctx: ExecutionContext) {
		await runScheduled(controller.cron, env);
	},
} satisfies ExportedHandler<Bindings>;
