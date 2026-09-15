import { Hono } from "hono";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { createDb } from "./db";
import { hasMigrated, migrateDatabase } from "./migrations";
import { adminRoutes } from "./routes/admin";
import { affiliateRoutes } from "./routes/affiliates";
import { aiInsightsRoutes } from "./routes/ai-insights";
import { analyticsRoutes } from "./routes/analytics";
import { annotationRoutes } from "./routes/annotations";
import { ascRoutes } from "./routes/appstoreconnect";
import { authRoutes } from "./routes/auth";
import { billingRoutes } from "./routes/billing";
import { billingWebhookRoutes } from "./routes/billing-webhook";
import { docsRoutes } from "./routes/docs";
import { emailReportRoutes } from "./routes/email-reports";
import { gscRoutes } from "./routes/gsc";
import { importRoutes } from "./routes/import";
import { integrationRoutes } from "./routes/integrations";
import { shopeeRoutes } from "./routes/marketplace-shopee";
import { tokopediaRoutes } from "./routes/marketplace-tokopedia";
import { paymentProviderRoutes } from "./routes/payment-providers";
import { predictionsRoutes } from "./routes/predictions";
import { pushTokenRoutes } from "./routes/push-tokens";
import { segmentRoutes } from "./routes/segments";
import { shareRoutes } from "./routes/share";
import { publicLiveRoutes } from "./routes/public-live";
import { siteRoutes } from "./routes/sites";
import { teamRoutes } from "./routes/team";
import { tokenRoutes } from "./routes/tokens";
import { trackRoutes } from "./routes/track";
import { v1Routes } from "./routes/v1";
import { mcpRoutes } from "./routes/mcp";
import { webhookRoutes } from "./routes/webhooks";
import { lemonsqueezyWebhookRoutes } from "./routes/webhooks-lemonsqueezy";
import { midtransWebhookRoutes } from "./routes/webhooks-midtrans";
import { polarWebhookRoutes } from "./routes/webhooks-polar";
import { pakasirWebhookRoutes } from "./routes/pakasir-webhook";
import { stripeWebhookRoutes } from "./routes/webhooks-stripe";
import { mayarWebhookRoutes } from "./routes/webhooks-mayar";
import { paywuzWebhookRoutes } from "./routes/webhooks-paywuz";
import { xenditWebhookRoutes } from "./routes/webhooks-xendit";
import { widgetRoutes } from "./routes/widgets";
import { widgetLiveRoutes } from "./routes/widgets-live";
import type { Env } from "./types";
import { hashToken } from "./utils";

const authMiddleware = createMiddleware<Env>(async (c, next) => {
	const authHeader = c.req.header("Authorization");
	if (!authHeader?.startsWith("Bearer "))
		return c.json({ error: "Unauthorized", success: false }, 401);

	const token = authHeader.slice(7);
	const db = c.get("db");
	if (!db) return c.json({ error: "Database unavailable", success: false }, 503);

	const keyHash = await hashToken(token);
	const apiKey = await db
		.selectFrom("api_keys")
		.select(["user_id", "token_type", "expires_at"])
		.where("key_hash", "=", keyHash)
		.executeTakeFirst();
	if (!apiKey) return c.json({ error: "Invalid token", success: false }, 401);
	// Dashboard API accepts user-scoped tokens only: session (kp_) and account
	// (rvt_) — site-scoped rv_ tokens must go through publicAuthMiddleware —
	// and expired tokens are dead.
	if (apiKey.token_type !== "session" && apiKey.token_type !== "account")
		return c.json({ error: "Session token required", success: false }, 401);
	if (apiKey.expires_at && new Date(apiKey.expires_at) <= new Date())
		return c.json({ error: "Token expired", success: false }, 401);

	c.set("userId", apiKey.user_id);
	await next();
});

const adminMiddleware = createMiddleware<Env>(async (c, next) => {
	const userId = c.get("userId");
	const db = c.get("db");
	if (!db) return c.json({ error: "Database unavailable", success: false }, 503);
	const user = await db
		.selectFrom("users")
		.select(["role"])
		.where("id", "=", userId)
		.executeTakeFirst();
	if (user?.role !== "super_admin") return c.json({ error: "Forbidden", success: false }, 403);
	await next();
});

export function createApp(): Hono<Env> {
	const app = new Hono<Env>().basePath("/api");
	app.use(cors());

	app.get("/", (c) => c.json({ message: "klikapa", version: "0.7.0", success: true }));
	app.get("/health", (c) => c.json({ status: "ok", build: "native-auth-v2", success: true }));
	app.route("/docs", docsRoutes);

	const MIGRATION_RETRY_MS = 60_000;
	let lastMigrationAttempt = 0;

	app.use(async (c, next) => {
		const d1 = c.env.DB;
		if (d1) {
			// Bind first: the API must serve even when migrations fail.
			c.set("db", createDb(d1));
			// Throttle failed-migration retries to one attempt per minute per isolate.
			if (!hasMigrated() && Date.now() - lastMigrationAttempt > MIGRATION_RETRY_MS) {
				lastMigrationAttempt = Date.now();
				try {
					await migrateDatabase(d1);
				} catch (err) {
					console.error("Migration error:", err);
				}
			}
		}
		await next();
	});

	app.route("/", trackRoutes);

	// Public API v1 (uses rvt_ and rv_ tokens, not kp_ session tokens)
	app.route("/v1", v1Routes);

	// MCP server over the same rvt_/rv_ tokens (Streamable HTTP, stateless)
	app.route("/mcp", mcpRoutes);

	// Auth routes are public. /auth/me and /auth/logout resolve the caller's
	// own Bearer token inline (resolveTokenUserId in routes/auth.ts).
	app.route("/auth", authRoutes);

	app.use("/sites/*", authMiddleware);
	app.route("/sites", siteRoutes);

	app.use("/analytics/*", authMiddleware);
	app.route("/analytics", analyticsRoutes);

	app.use("/ai-insights/*", authMiddleware);
	app.route("/ai-insights", aiInsightsRoutes);

	app.use("/integrations/*", authMiddleware);
	app.route("/integrations", integrationRoutes);

	app.use("/appstoreconnect/*", authMiddleware);
	app.route("/appstoreconnect", ascRoutes);

	app.use("/tokens/*", authMiddleware);
	app.route("/tokens", tokenRoutes);

	app.route("/webhooks", webhookRoutes);
	app.route("/webhooks/midtrans", midtransWebhookRoutes);
	app.route("/webhooks/xendit", xenditWebhookRoutes);
	app.route("/webhooks/stripe", stripeWebhookRoutes);
	app.route("/webhooks/lemonsqueezy", lemonsqueezyWebhookRoutes);
	app.route("/webhooks/polar", polarWebhookRoutes);
	app.route("/webhooks/pakasir", pakasirWebhookRoutes);
	app.route("/webhooks/paywuz", paywuzWebhookRoutes);
	app.route("/webhooks/mayar", mayarWebhookRoutes);

	app.use("/payment-providers/*", authMiddleware);
	app.route("/payment-providers", paymentProviderRoutes);

	// Serve tracking script based on site plan tier
	app.get("/klikapa.js", async (c) => {
		const referer = c.req.header("Referer") || "";
		let siteId = "";
		try {
			siteId = new URL(referer).searchParams.get("site_id") || "";
		} catch {}
		siteId = siteId || c.req.query("site_id") || "";

		let isFull = false;
		if (siteId) {
			try {
				const d1 = c.env.DB;
				if (d1) {
					const db = createDb(d1);
					const site = await db
						.selectFrom("sites")
						.select(["id", "user_id"])
						.where("id", "=", siteId)
						.executeTakeFirst();
					if (site) {
						const sub = await db
							.selectFrom("subscriptions")
							.select(["plan"])
							.where("user_id", "=", site.user_id)
							.executeTakeFirst();
						if (sub && sub.plan === "growth") isFull = true;
					}
				}
			} catch {
				/* default to core */
			}
		}

		const base = new URL(c.req.url).origin;
		return c.redirect(isFull ? `${base}/klikapa-full.js` : `${base}/klikapa-core.js`, 302);
	});

	// Billing webhook (no auth — Polar calls this)
	app.route("/billing/webhook", billingWebhookRoutes);

	app.use("/billing/*", authMiddleware);
	app.route("/billing", billingRoutes);

	app.use("/team/*", authMiddleware);
	app.route("/team", teamRoutes);

	app.use("/push-tokens/*", authMiddleware);
	app.route("/push-tokens", pushTokenRoutes);

	app.use("/segments/*", authMiddleware);
	app.route("/segments", segmentRoutes);

	app.use("/annotations/*", authMiddleware);
	app.route("/annotations", annotationRoutes);

	app.use("/email-reports/*", authMiddleware);
	app.route("/email-reports", emailReportRoutes);

	app.use("/share/*", authMiddleware);
	app.route("/share", shareRoutes);

	// GSC routes: auth/callback are public (OAuth flow), queries/sync are authenticated
	app.route("/gsc", gscRoutes);

	app.use("/predictions/*", authMiddleware);
	app.route("/predictions", predictionsRoutes);

	app.use("/affiliates/*", authMiddleware);
	app.route("/affiliates", affiliateRoutes);

	// Marketplace routes: auth/callback are public (OAuth flow), sync/orders are authenticated
	app.route("/marketplace/shopee", shopeeRoutes);
	app.route("/marketplace/tokopedia", tokopediaRoutes);

	// Public dashboard (no auth)
	app.route("/public", publicLiveRoutes);
	app.get("/public/:token", async (c) => {
		const d1 = c.env.DB;
		if (!d1) return c.json({ error: "DB unavailable", success: false }, 503);
		try {
			await migrateDatabase(d1);
		} catch {}
		c.set("db", createDb(d1));

		const token = c.req.param("token");
		const db = c.get("db") as Kysely<KlikapaDatabase>;
		const site = await db
			.selectFrom("sites")
			.select(["id", "name", "domain", "public_dashboard"])
			.where("share_token", "=", token)
			.where("public_dashboard", "=", 1)
			.executeTakeFirst();
		if (!site) return c.json({ error: "Dashboard not found", success: false }, 404);

		const { getDateRange } = await import("./utils");
		const range = c.req.query("range") || "7d";
		const { start } = getDateRange(range);
		const startIso = start.toISOString();

		const {
			getOverviewStats,
			getTimeseries,
			getTopPages,
			getReferrers,
			getDeviceBreakdown,
			getRevenueBySource,
			getRevenueByCountry,
			getRevenueTimeseries,
			getChannelBreakdown,
		} = await import("./queries/analytics");
		const [
			stats,
			timeseries,
			topPages,
			sources,
			{ devices, os, browsers },
			revenueBySource,
			revenueByCountry,
			revenueTimeseries,
			channels,
		] = await Promise.all([
			getOverviewStats(db, site.id, startIso),
			getTimeseries(db, site.id, startIso, false),
			getTopPages(db, site.id, startIso, 10),
			getReferrers(db, site.id, startIso, 10),
			getDeviceBreakdown(db, site.id, startIso),
			getRevenueBySource(db, site.id, startIso),
			getRevenueByCountry(db, site.id, startIso),
			getRevenueTimeseries(db, site.id, startIso, false),
			getChannelBreakdown(db, site.id, startIso),
		]);

		return c.json({
			data: {
				site: { name: site.name, domain: site.domain },
				dashboard: {
					stats,
					timeseries,
					topPages,
					sources,
					devices,
					os,
					browsers,
					revenueBySource,
					revenueByCountry,
					revenueTimeseries,
					channels,
				},
			},
			success: true,
		});
	});

	app.route("/widget-data", widgetRoutes);

	// Public live-stats widget (no auth — gated by per-site widget_token)
	app.route("/widgets/live", widgetLiveRoutes);

	// Import routes (regular auth — any authenticated user can import to their own sites)
	app.use("/import/*", authMiddleware);
	app.route("/import", importRoutes);

	// Admin routes (super_admin only)
	app.use("/admin/*", authMiddleware);
	app.use("/admin/*", adminMiddleware);
	app.route("/admin", adminRoutes);

	app.onError((err, c) => {
		console.error("Server error:", err);
		return c.json({ error: err.message, success: false }, 500);
	});

	return app;
}
