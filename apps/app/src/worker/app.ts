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
import { accountLinkRoutes } from "./routes/account-links";
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
import { feeRuleRoutes } from "./routes/fee-rules";
import { paymentProviderRoutes } from "./routes/payment-providers";
import { polarConnectRoutes } from "./routes/polar-connect";
import { portfolioRoutes } from "./routes/portfolio";
import { pushRoutes } from "./routes/push";
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
import { dokuWebhookRoutes } from "./routes/webhooks-doku";
import { paywuzWebhookRoutes } from "./routes/webhooks-paywuz";
import { xenditWebhookRoutes } from "./routes/webhooks-xendit";
import { widgetRoutes } from "./routes/widgets";
import { widgetLiveRoutes } from "./routes/widgets-live";
import {
	requireActiveSubscription,
	requirePlanTier,
	type ResourceSiteResolver,
} from "./lib/plan-gate";
import { isSelfHosted } from "./lib/entitlement";
import { refreshSessionExpiry } from "./lib/session";
import { beginRequestAccess } from "./lib/site-access";
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
	// Dashboard API accepts session (kp_) tokens only: account rvt_ and site rv_
	// tokens are API credentials and authenticate on /v1 and /mcp instead.
	if (apiKey.token_type !== "session")
		return c.json({ error: "Session token required", success: false }, 401);
	if (apiKey.expires_at && new Date(apiKey.expires_at) <= new Date())
		return c.json({ error: "Token expired", success: false }, 401);
	await refreshSessionExpiry(db, keyHash, apiKey.expires_at);

	c.set("userId", apiKey.user_id);
	beginRequestAccess(db, apiKey.user_id);
	await next();
});

/** /integrations/:id[/...] is gated on the integration's own site, not the query. */
const integrationSiteId: ResourceSiteResolver = async (c) => {
	const id = /^\/api\/integrations\/([^/]+)/.exec(c.req.path)?.[1];
	if (!id) return undefined;
	const row = await c
		.get("db")
		.selectFrom("integrations")
		.select(["site_id"])
		.where("id", "=", id)
		.executeTakeFirst();
	return row?.site_id;
};

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

/**
 * 404 on routes that only exist for RevKlik's own hosted billing (plans,
 * checkout, Polar/Pakasir subscription webhooks, referral payouts) when the
 * instance runs with SELF_HOSTED=1.
 */
const hostedOnly = (feature: string) =>
	createMiddleware<Env>(async (c, next) => {
		if (!isSelfHosted(c.env)) return next();
		return c.json(
			{ error: `${feature} is disabled on self-hosted instances`, success: false },
			404,
		);
	});

export function createApp(): Hono<Env> {
	const app = new Hono<Env>().basePath("/api");
	app.use(cors());

	// Public instance config the SPA reads at startup (self_hosted hides pricing/upgrade UI).
	app.get("/", (c) =>
		c.json({
			message: "klikapa",
			version: "0.7.0",
			self_hosted: isSelfHosted(c.env),
			success: true,
		}),
	);
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
			if (!hasMigrated(d1) && Date.now() - lastMigrationAttempt > MIGRATION_RETRY_MS) {
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
	// Linked accounts + switcher resolve their own session token the same way.
	app.route("/auth", accountLinkRoutes);

	app.use("/sites/*", authMiddleware);
	app.route("/sites", siteRoutes);

	app.use("/analytics/*", authMiddleware);
	app.use("/analytics/*", requireActiveSubscription);
	app.use("/analytics/funnel", requirePlanTier("starter"));
	app.route("/analytics", analyticsRoutes);

	app.use("/portfolio/*", authMiddleware);
	app.use("/portfolio/*", requireActiveSubscription);
	app.route("/portfolio", portfolioRoutes);

	app.use("/fee-rules/*", authMiddleware);
	app.route("/fee-rules", feeRuleRoutes);

	app.use("/ai-insights/*", authMiddleware);
	app.use("/ai-insights/*", requireActiveSubscription);
	app.route("/ai-insights", aiInsightsRoutes);

	// Removing an integration stays possible after a downgrade.
	app.use("/integrations/*", authMiddleware);
	app.use(
		"/integrations/*",
		requirePlanTier("growth", ["POST", "PATCH", "PUT"], integrationSiteId),
	);
	app.route("/integrations", integrationRoutes);

	app.use("/appstoreconnect/*", authMiddleware);
	app.use("/appstoreconnect/*", requireActiveSubscription);
	app.route("/appstoreconnect", ascRoutes);

	app.use("/tokens/*", authMiddleware);
	app.route("/tokens", tokenRoutes);

	app.route("/webhooks", webhookRoutes);
	app.route("/webhooks/midtrans", midtransWebhookRoutes);
	app.route("/webhooks/xendit", xenditWebhookRoutes);
	app.route("/webhooks/stripe", stripeWebhookRoutes);
	app.route("/webhooks/lemonsqueezy", lemonsqueezyWebhookRoutes);
	app.route("/webhooks/polar", polarWebhookRoutes);
	app.use("/webhooks/pakasir/*", hostedOnly("Pakasir billing"));
	app.route("/webhooks/pakasir", pakasirWebhookRoutes);
	app.route("/webhooks/paywuz", paywuzWebhookRoutes);
	app.route("/webhooks/mayar", mayarWebhookRoutes);
	app.route("/webhooks/doku", dokuWebhookRoutes);

	app.use("/payment-providers/*", authMiddleware);
	app.use("/payment-providers/*", requirePlanTier("starter", ["POST", "PATCH", "PUT"]));
	app.route("/payment-providers", paymentProviderRoutes);

	// Polar webhook secret, access token and order sync for a site. Removing stays possible after a downgrade.
	app.use("/polar/*", authMiddleware);
	app.use("/polar/*", requirePlanTier("starter", ["POST", "PUT", "PATCH"]));
	app.route("/polar", polarConnectRoutes);

	// Serve tracking script based on site plan tier
	app.get("/klikapa.js", async (c) => {
		const referer = c.req.header("Referer") || "";
		let siteId = "";
		try {
			siteId = new URL(referer).searchParams.get("site_id") || "";
		} catch {}
		siteId = siteId || c.req.query("site_id") || "";

		// Self-hosted installs have no plan tiers: everyone gets the full script.
		let isFull = isSelfHosted(c.env);
		if (siteId && !isFull) {
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
	app.use("/billing/webhook/*", hostedOnly("Billing"));
	app.route("/billing/webhook", billingWebhookRoutes);

	app.use("/billing/*", authMiddleware);
	// /billing/subscription stays (it reports the unlimited self-hosted plan); /alerts
	// and /test-email are email preferences, not billing.
	for (const path of [
		"/billing/plans",
		"/billing/checkout/*",
		"/billing/pakasir/*",
		"/billing/cancel",
	]) {
		app.use(path, hostedOnly("Billing"));
	}
	app.route("/billing", billingRoutes);

	app.use("/team/*", authMiddleware);
	app.use("/team/invite", requirePlanTier("growth"));
	app.route("/team", teamRoutes);

	// Not subscription-gated: a lapsed user still hears about money arriving.
	app.use("/push/*", authMiddleware);
	app.route("/push", pushRoutes);

	app.use("/segments/*", authMiddleware);
	app.use("/segments/*", requirePlanTier("starter", ["POST"]));
	app.route("/segments", segmentRoutes);

	app.use("/annotations/*", authMiddleware);
	app.route("/annotations", annotationRoutes);

	app.use("/email-reports/*", authMiddleware);
	app.route("/email-reports", emailReportRoutes);

	app.use("/share/*", authMiddleware);
	app.route("/share", shareRoutes);

	// GSC routes: auth/callback are public (OAuth flow), queries/sync are authenticated
	app.route("/gsc", gscRoutes);

	app.use("/affiliates/*", hostedOnly("The referral program"));
	app.use("/affiliates/*", authMiddleware);
	app.route("/affiliates", affiliateRoutes);

	// Marketplace routes: auth/callback are public (OAuth flow), sync/orders are authenticated
	app.route("/marketplace/shopee", shopeeRoutes);
	app.route("/marketplace/tokopedia", tokopediaRoutes);

	// Public dashboard (no auth)
	app.route("/public", publicLiveRoutes);
	app.get("/public/:token", async (c) => {
		const db = c.get("db") as Kysely<KlikapaDatabase> | undefined;
		if (!db) return c.json({ error: "DB unavailable", success: false }, 503);
		const token = c.req.param("token");
		const site = await db
			.selectFrom("sites")
			.select(["id", "name", "domain", "public_dashboard"])
			.where("share_token", "=", token)
			.where("public_dashboard", "=", 1)
			.executeTakeFirst();
		if (!site) return c.json({ error: "Dashboard not found", success: false }, 404);

		const { getDateRange } = await import("./utils");
		const { resolveQueryScope } = await import("./lib/site-scope");
		const range = c.req.query("range") || "7d";
		const { start } = getDateRange(range);
		const startIso = start.toISOString();
		const scope = await resolveQueryScope(db, site.id, c.env, c.req.query("tz"));

		const {
			getOverviewStats,
			getTimeseries,
			getTopPages,
			getReferrers,
			getDeviceBreakdown,
			getRevenueBySource,
			getRevenueByCountry,
			getRevenueTimeseries,
			getRevenueByPaymentMethod,
			getRevenueByPaymentProvider,
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
			revenueByMethod,
			revenueByProvider,
			channels,
		] = await Promise.all([
			getOverviewStats(db, site.id, startIso, undefined, undefined, scope),
			getTimeseries(db, site.id, startIso, false, undefined, undefined, scope),
			getTopPages(db, site.id, startIso, 10),
			getReferrers(db, site.id, startIso, 10),
			getDeviceBreakdown(db, site.id, startIso),
			getRevenueBySource(db, site.id, startIso, undefined, undefined, scope),
			getRevenueByCountry(db, site.id, startIso, undefined, undefined, scope),
			getRevenueTimeseries(db, site.id, startIso, false, undefined, undefined, scope),
			getRevenueByPaymentMethod(db, site.id, startIso, undefined, undefined, scope),
			getRevenueByPaymentProvider(db, site.id, startIso, undefined, undefined, scope),
			getChannelBreakdown(db, site.id, startIso, undefined, undefined, scope),
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
					revenueByMethod,
					revenueByProvider,
					channels,
					currency: scope.money.currency,
				},
			},
			currency: scope.money.currency,
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
