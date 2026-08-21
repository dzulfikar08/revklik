import { createApp } from "./app";
import { createDb } from "./db";
import { processPolarOrder, refreshPolarOrder } from "./lib/polar";
import type { Bindings } from "./types";

const app = createApp();

export default {
	async fetch(
		request: Request,
		env: Bindings,
		ctx: ExecutionContext,
	): Promise<Response> {
		const { pathname } = new URL(request.url);
		if (pathname.startsWith("/api/")) return app.fetch(request, env, ctx);
		return env.ASSETS.fetch(request);
	},
	async scheduled(
		controller: ScheduledController,
		env: Bindings,
		_ctx: ExecutionContext,
	) {
		const polarToken = env.POLAR_ACCESS_TOKEN || "";
		const polarOrgId = env.POLAR_ORG_ID || "";
		if (!polarToken || !polarOrgId || !env.DB) {
			console.error(
				"Polar cron sync: missing POLAR_ACCESS_TOKEN, POLAR_ORG_ID, or DB binding",
			);
			return;
		}

		const db = createDb(env.DB);
		const isRefresh = controller.cron === "0 5 * * *";
		// Catch-up sync scans the last 7 days; the refresh cron scans a wider
		// 30-day window so it can re-price older conversions whose amount drifted
		// (e.g. a price was lowered and existing orders were never re-priced).
		const since = new Date(
			Date.now() - (isRefresh ? 30 : 7) * 86400000,
		).toISOString();
		let page = 1;
		let hasMore = true;
		let handled = 0;

		while (hasMore) {
			try {
				const res = await fetch(
					`https://api.polar.sh/v1/orders?organization_id=${polarOrgId}&page=${page}&limit=100&sorting=-created_at&since=${encodeURIComponent(since)}`,
					{
						headers: {
							Authorization: `Bearer ${polarToken}`,
							"Content-Type": "application/json",
						},
					},
				);
				if (!res.ok) {
					console.error(`Polar cron sync API error: ${res.status}`);
					break;
				}

				type PolarOrder = {
					id: string;
					status?: string;
					total_amount?: number | null;
					customer?: { email?: string };
					customer_email?: string;
				};
				type Pagination = { max_page?: number; total_pages?: number };
				const data = (await res.json()) as {
					items?: PolarOrder[];
					data?: PolarOrder[] | { items?: PolarOrder[]; pagination?: Pagination };
					result?: { items?: PolarOrder[] };
					pagination?: Pagination;
					meta?: Pagination;
				};
				const dd = data.data;
				const orders: PolarOrder[] =
					data.items ??
					(Array.isArray(dd) ? dd : dd?.items) ??
					data.result?.items ??
					[];
				const pagination: Pagination =
					data.pagination ??
					(!Array.isArray(dd) ? dd?.pagination : undefined) ??
					data.meta ??
					{};
				hasMore = page < (pagination.max_page ?? pagination.total_pages ?? 1);

				for (const order of orders) {
					if (order.status !== "paid") continue;
					// Resolve user by customer email, then find their site
					const customerEmail = order.customer?.email || order.customer_email;
					if (!customerEmail) continue;
					const user = await db
						.selectFrom("users")
						.select(["id"])
						.where("email", "=", customerEmail)
						.executeTakeFirst();
					if (!user) continue;
					const site = await db
						.selectFrom("sites")
						.select(["id"])
						.where("user_id", "=", user.id)
						.limit(1)
						.executeTakeFirst();
					if (!site) continue;

					const result = isRefresh
						? await refreshPolarOrder(db, order, site.id)
						: await processPolarOrder(db, order, site.id);
					if (result === (isRefresh ? "updated" : "imported")) handled++;
				}
				page++;
			} catch (err) {
				console.error("Polar cron sync error:", err);
				break;
			}
		}
		console.log(
			`Polar cron ${isRefresh ? "refresh" : "sync"} complete: ${handled} orders ${isRefresh ? "updated" : "synced"}`,
		);
	},
} satisfies ExportedHandler<Bindings>;
