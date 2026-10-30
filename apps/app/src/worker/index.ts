import { createApp } from "./app";
import { runScheduled } from "./cron";
import { isSpaRoute } from "./lib/spa-routes";
import type { Bindings } from "./types";

const app = createApp();

export default {
	async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
		const { pathname } = new URL(request.url);
		if (pathname.startsWith("/api/")) return app.fetch(request, env, ctx);
		const res = await env.ASSETS.fetch(request);
		// The assets runtime answers unknown paths with the SPA shell (status 200). Keep the
		// shell, so the dashboard renders its not-found view, but tell crawlers it is a 404.
		if (res.ok && !isSpaRoute(pathname) && res.headers.get("content-type")?.includes("text/html")) {
			return new Response(res.body, { status: 404, headers: res.headers });
		}
		return res;
	},
	async scheduled(controller: ScheduledController, env: Bindings, _ctx: ExecutionContext) {
		await runScheduled(controller.cron, env);
	},
} satisfies ExportedHandler<Bindings>;
