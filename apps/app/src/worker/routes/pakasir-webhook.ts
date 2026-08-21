import { Hono } from "hono";
import { createDb, sql } from "../db";
import type { Env } from "../types";
import { generateId } from "../utils";

// Subset of the Pakasir webhook payload read by this handler.
interface PakasirWebhookBody {
	amount: number;
	order_id: string;
	project: string;
	status: string;
	payment_method?: string | null;
	completed_at?: string | null;
}

export const pakasirWebhookRoutes = new Hono<Env>();

// POST / — Pakasir webhook (no auth — Pakasir calls this)
pakasirWebhookRoutes.post("/", async (c) => {
	const d1 = c.env.DB;
	if (!d1) return c.json({ error: "DB unavailable" }, 503);
	const db = createDb(d1);

	try {
		const body = await c.req.json<PakasirWebhookBody>();
		const { amount, order_id, project, status, payment_method, completed_at } =
			body;

		// Verify project slug
		if (project !== "revklik") {
			return c.json({ error: "Invalid project" }, 400);
		}

		if (status !== "completed") {
			return c.json({ success: true, note: "Payment not completed" });
		}

		// Extract user ID from order_id format: RVK-{userId8}-{timestamp}
		const parts = order_id.split("-");
		if (parts.length < 3) {
			return c.json({ error: "Invalid order_id format" }, 400);
		}
		const userIdPrefix = parts[1];

		// Find user by ID prefix
		const user = await db
			.selectFrom("users")
			.select(["id"])
			.where("id", "like", `${userIdPrefix}%`)
			.executeTakeFirst();
		if (!user) {
			return c.json({ error: "User not found for order" }, 404);
		}
		const userId = user.id;

		// Determine plan from amount
		let plan: string;
		if (amount <= 16000) plan = "micro";
		else if (amount <= 64000) plan = "starter";
		else plan = "growth";

		// Verify amount matches plan
		const expectedAmount =
			amount <= 16000 ? 16000 : amount <= 64000 ? 64000 : 192000;
		if (Math.abs(amount - expectedAmount) > 1000) {
			return c.json({ error: "Amount mismatch" }, 400);
		}

		// Update subscription to active
		await db
			.insertInto("subscriptions")
			.values({
				id: generateId(),
				user_id: userId,
				plan,
				status: "active",
				current_period_start: new Date().toISOString(),
				current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
				cancel_at_period_end: 0,
				polar_subscription_id: null,
				polar_customer_id: null,
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
			})
			.onConflict((oc) =>
				oc.column("user_id").doUpdateSet({
					plan,
					status: "active",
					current_period_start: new Date().toISOString(),
					current_period_end: new Date(
						Date.now() + 30 * 86400000,
					).toISOString(),
					cancel_at_period_end: 0,
					updated_at: new Date().toISOString(),
				}),
			)
			.execute();

		// Revenue attribution
		const userSites = await db
			.selectFrom("sites")
			.select(["id"])
			.where("user_id", "=", userId)
			.limit(1)
			.execute();
		const siteId = userSites[0]?.id;
		if (siteId) {
			const planPrice = plan === "growth" ? 12 : plan === "starter" ? 4 : 1;
			const ts = completed_at || new Date().toISOString();
			const visitorId = `pakasir_${order_id.replace(/[^a-zA-Z0-9]/g, "_")}`;

			await db
				.insertInto("events")
				.values({
					id: generateId(),
					site_id: siteId,
					session_id: generateId(),
					visitor_id: visitorId,
					timestamp: ts,
					event_type: "conversion",
					name: "subscription_payment",
					path: "/billing/pakasir",
					hostname: null,
					referrer: null,
					utm_source: null,
					utm_medium: null,
					utm_campaign: null,
					utm_term: null,
					utm_content: null,
					country: "ID",
					region: null,
					city: null,
					device_type: null,
					browser: null,
					os: null,
					revenue: planPrice,
					props: JSON.stringify({
						plan,
						order_id,
						payment_method,
						source: "pakasir_webhook",
						amount_idr: amount,
					}),
					fingerprint: null,
				})
				.execute();

			await db
				.insertInto("visitor_profiles")
				.values({
					id: generateId(),
					site_id: siteId,
					visitor_id: visitorId,
					first_seen: ts,
					last_seen: ts,
					country: "ID",
					region: null,
					city: null,
					device_type: null,
					browser: null,
					os: null,
					total_sessions: 0,
					total_pageviews: 0,
					total_revenue: planPrice,
					fingerprint: null,
				})
				.onConflict((oc) =>
					oc.columns(["site_id", "visitor_id"]).doUpdateSet({
						last_seen: ts,
						total_revenue: sql`total_revenue + ${planPrice}`,
					}),
				)
				.execute();
		}

		return c.json({ success: true });
	} catch (err) {
		return c.json(
			{ error: err instanceof Error ? err.message : "Webhook error" },
			500,
		);
	}
});
