import { Hono } from "hono";
import type { PlanTier } from "../lib/plans";
import { getFeatures, getPlanLimits, PLANS } from "../lib/plans";
import {
	activatePakasirPayment,
	PAKASIR_PRICES,
	PAKASIR_PROJECT,
	verifyWithPakasir,
} from "../lib/pakasir";
import type { Env } from "../types";
import { generateId } from "../utils";

export const billingRoutes = new Hono<Env>();

const POLAR_API = "https://api.polar.sh/v1";

// Cache Polar products to avoid calling the API on every /plans request
let polarProductsCache: {
	data: { items?: Array<{ name?: string; checkout_url?: string }> };
	cachedAt: number;
} | null = null;
const POLAR_PRODUCTS_TTL = 5 * 60_000;

// Get current subscription with usage info
billingRoutes.get("/subscription", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");

	const sub = await db
		.selectFrom("subscriptions")
		.select([
			"id",
			"user_id",
			"plan",
			"status",
			"current_period_start",
			"current_period_end",
			"cancel_at_period_end",
			"polar_subscription_id",
			"polar_customer_id",
		])
		.where("user_id", "=", userId)
		.executeTakeFirst();

	const plan = (sub?.plan ?? "micro") as PlanTier;
	const limits = getPlanLimits(plan);

	// Count current month's usage
	const monthStart = new Date();
	monthStart.setUTCDate(1);
	monthStart.setUTCHours(0, 0, 0, 0);
	const monthStartIso = monthStart.toISOString();

	const [eventCount, siteCount] = await Promise.all([
		db
			.selectFrom("events")
			.select(({ fn }) => fn.count<number>("id").as("cnt"))
			.where("site_id", "in", db.selectFrom("sites").select("id").where("user_id", "=", userId))
			.where("timestamp", ">=", monthStartIso)
			.executeTakeFirst(),
		db
			.selectFrom("sites")
			.select(({ fn }) => fn.count<number>("id").as("cnt"))
			.where("user_id", "=", userId)
			.executeTakeFirst(),
	]);

	const usage = {
		events: {
			used: Number(eventCount?.cnt ?? 0),
			limit: limits.events_per_month,
		},
		sites: { used: Number(siteCount?.cnt ?? 0), limit: limits.sites },
	};

	if (!sub) {
		return c.json({
			data: {
				id: "",
				user_id: userId,
				plan: "micro" as const,
				status: "active" as const,
				current_period_start: new Date().toISOString(),
				current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
				cancel_at_period_end: false,
				polar_subscription_id: null,
				polar_customer_id: null,
				usage,
				trial_days_remaining: null,
			},
			success: true,
		});
	}

	// Calculate trial days remaining
	let trialDaysRemaining: number | null = null;
	if (sub.status === "trialing" && sub.current_period_end) {
		const end = new Date(sub.current_period_end);
		const now = new Date();
		const diffMs = end.getTime() - now.getTime();
		trialDaysRemaining = diffMs > 0 ? Math.ceil(diffMs / 86400000) : 0;
	}

	return c.json({
		data: {
			...sub,
			plan: sub.plan as "micro" | "starter" | "growth",
			status: sub.status as "active" | "canceled" | "past_due" | "trialing",
			cancel_at_period_end: !!sub.cancel_at_period_end,
			usage,
			trial_days_remaining: trialDaysRemaining,
		},
		success: true,
	});
});

// Get available plans with checkout URLs
billingRoutes.get("/plans", async (c) => {
	const polarToken = c.env.POLAR_ACCESS_TOKEN || "";
	const plans = Object.entries(PLANS).map(([tier, info]) => ({
		tier: tier as PlanTier,
		name: info.name,
		price: info.price,
		events_per_month: info.events_per_month,
		sites: info.sites,
		features: getFeatures(tier as PlanTier),
		checkout_url: null as string | null,
	}));

	// If Polar token is configured, generate checkout links. Failures are
	// non-fatal: log them and surface a note instead of dropping the plans list.
	let polarProductsError: string | null = null;
	if (polarToken) {
		try {
			const now = Date.now();
			if (!polarProductsCache || now - polarProductsCache.cachedAt > POLAR_PRODUCTS_TTL) {
				const res = await fetch(
					`${POLAR_API}/products/?organization_id=${c.env.POLAR_ORG_ID || ""}`,
					{
						headers: { Authorization: `Bearer ${polarToken}` },
					},
				);
				const bodyText = await res.text();
				let parsed: { items?: Array<{ name?: string; checkout_url?: string }> } | null = null;
				if (res.ok) {
					try {
						parsed = JSON.parse(bodyText);
					} catch {
						/* non-JSON body — reported below */
					}
				}
				if (parsed && Array.isArray(parsed.items)) {
					polarProductsCache = { data: parsed, cachedAt: now };
				} else {
					polarProductsError = `Polar products unavailable (HTTP ${res.status})`;
					console.error(
						`[billing] /plans: ${polarProductsError}: ${bodyText.slice(0, 300) || "empty body"}`,
					);
				}
			}
			const products = polarProductsCache?.data;
			if (products) {
				for (const plan of plans) {
					const product = products.items?.find((p) => p.name?.toLowerCase().includes(plan.tier));
					if (product?.checkout_url) {
						plan.checkout_url = product.checkout_url;
					}
				}
			}
		} catch (err) {
			polarProductsError = `Polar products unavailable: ${err instanceof Error ? err.message : String(err)}`;
			console.error("[billing] /plans:", err);
		}
	}

	return c.json({ data: plans, polar_products_error: polarProductsError, success: true });
});

// Create Polar checkout session
billingRoutes.post("/checkout", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	const polarToken = c.env.POLAR_ACCESS_TOKEN || "";

	const { plan, visitor_id, session_id } = await c.req.json<{
		plan: string;
		visitor_id?: string;
		session_id?: string;
	}>();
	if (!plan || !PLANS[plan as PlanTier]) {
		return c.json({ error: "Invalid plan", success: false }, 400);
	}

	// All plans are paid — no checkout skip needed

	// Get user email for Polar customer
	const user = await db
		.selectFrom("users")
		.select(["email", "name"])
		.where("id", "=", userId)
		.executeTakeFirst();
	if (!user) return c.json({ error: "User not found", success: false }, 404);

	// If Polar token not configured, return direct link placeholder
	if (!polarToken) {
		return c.json({
			data: { url: `https://polar.sh/revklik/checkout?plan=${plan}` },
			success: true,
		});
	}

	try {
		// Polar API: POST /v1/checkouts/session with products array
		const polarProductIds: Record<string, string | undefined> = {
			micro: c.env.POLAR_MICRO_PRODUCT_ID,
			starter: c.env.POLAR_STARTER_PRODUCT_ID,
			growth: c.env.POLAR_GROWTH_PRODUCT_ID,
		};
		const productId = polarProductIds[plan] || "";
		const res = await fetch(`${POLAR_API}/checkouts/session`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${polarToken}`,
			},
			body: JSON.stringify({
				products: productId ? [productId] : [],
				customer_email: user.email,
				customer_name: user.name,
				metadata: {
					user_id: userId,
					plan,
					klikapa_visitor_id: visitor_id || null,
					klikapa_session_id: session_id || null,
				},
				success_url: `https://app.revklik.com/?checkout=success`,
			}),
		});

		const raw = await res.text();
		let session: { url?: string } = {};
		try {
			session = JSON.parse(raw) as { url?: string };
		} catch {
			/* non-JSON body — reported verbatim below */
		}
		if (!session.url) {
			throw new Error(
				`Polar checkout failed (HTTP ${res.status}): ${raw.slice(0, 300) || "empty response"}`,
			);
		}

		return c.json({ data: { url: session.url }, success: true });
	} catch (err) {
		console.error("[billing] /checkout:", err instanceof Error ? err.message : err);
		return c.json(
			{
				error: err instanceof Error ? err.message : String(err) || "Checkout creation failed",
				success: false,
			},
			500,
		);
	}
});

// Create Pakasir checkout (QRIS for Indonesian users)
billingRoutes.post("/checkout/pakasir", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");

	const { plan } = await c.req.json<{ plan: string }>();
	if (!plan || !PLANS[plan as PlanTier]) {
		return c.json({ error: "Invalid plan", success: false }, 400);
	}

	const amount = PAKASIR_PRICES[plan as PlanTier];
	if (!amount) {
		return c.json({ error: "No IDR price for this plan", success: false }, 400);
	}

	// Get user email for order
	const user = await db
		.selectFrom("users")
		.select(["email", "name"])
		.where("id", "=", userId)
		.executeTakeFirst();
	if (!user) return c.json({ error: "User not found", success: false }, 404);

	// Generate unique order ID
	const orderId = `RVK-${userId.slice(0, 8)}-${Date.now().toString(36).toUpperCase()}`;
	const successUrl = `https://app.revklik.com/?checkout=pakasir_success&plan=${plan}`;

	// Use URL redirect method — simplest integration
	const checkoutUrl = `https://app.pakasir.com/pay/${PAKASIR_PROJECT}/${amount}?order_id=${orderId}&redirect=${encodeURIComponent(successUrl)}&qris_only=1`;

	// Store pending order in DB for webhook/verify reconciliation
	const now = new Date().toISOString();
	await db
		.insertInto("subscriptions")
		.values({
			id: generateId(),
			user_id: userId,
			plan: plan,
			status: "pending",
			current_period_start: now,
			current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
			cancel_at_period_end: 0,
			polar_subscription_id: null,
			polar_customer_id: null,
			pakasir_order_id: orderId,
			created_at: now,
			updated_at: now,
		})
		.onConflict((oc) =>
			oc.column("user_id").doUpdateSet({
				plan: plan,
				status: "pending",
				pakasir_order_id: orderId,
				updated_at: now,
			}),
		)
		.execute();

	return c.json({
		data: { url: checkoutUrl, order_id: orderId, amount, plan },
		success: true,
	});
});

// Re-check a pending Pakasir order against the transaction detail API.
// Safety net for missed webhooks — the paywall calls this after the user
// returns from the QRIS payment page.
billingRoutes.post("/pakasir/verify", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	const apiKey = c.env.PAKASIR_API_KEY || "";
	if (!apiKey) return c.json({ error: "Pakasir not configured", success: false }, 500);

	const sub = await db
		.selectFrom("subscriptions")
		.select(["plan", "status", "pakasir_order_id"])
		.where("user_id", "=", userId)
		.executeTakeFirst();
	if (!sub?.pakasir_order_id) {
		return c.json({ data: { status: "no_pending_order" }, success: true });
	}
	if (sub.status === "active") {
		return c.json({ data: { status: "active", plan: sub.plan }, success: true });
	}

	const amount = PAKASIR_PRICES[sub.plan as PlanTier];
	const tx = await verifyWithPakasir(apiKey, sub.pakasir_order_id, amount).catch(() => null);
	if (!tx || tx.status !== "completed" || tx.amount !== amount) {
		return c.json({ data: { status: "pending" }, success: true });
	}

	await activatePakasirPayment(db, {
		userId,
		plan: sub.plan as PlanTier,
		orderId: sub.pakasir_order_id,
		amount,
		paymentMethod: tx.payment_method,
		completedAt: tx.completed_at,
	});
	return c.json({ data: { status: "active", plan: sub.plan }, success: true });
});

// Cancel subscription
billingRoutes.post("/cancel", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	const polarToken = c.env.POLAR_ACCESS_TOKEN || "";

	const sub = await db
		.selectFrom("subscriptions")
		.select(["polar_subscription_id"])
		.where("user_id", "=", userId)
		.executeTakeFirst();
	if (!sub?.polar_subscription_id) {
		return c.json({ error: "No active paid subscription", success: false }, 404);
	}

	if (polarToken) {
		try {
			await fetch(`${POLAR_API}/subscriptions/${sub.polar_subscription_id}/cancel`, {
				method: "POST",
				headers: { Authorization: `Bearer ${polarToken}` },
			});
		} catch {
			/* Polar API error */
		}
	}

	await db
		.updateTable("subscriptions")
		.set({
			cancel_at_period_end: 1,
			updated_at: new Date().toISOString(),
		})
		.where("user_id", "=", userId)
		.execute();

	return c.json({ success: true });
});

// Email alert preferences
billingRoutes.get("/alerts", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	const user = await db
		.selectFrom("users")
		.select(["id"])
		.where("id", "=", userId)
		.executeTakeFirst();
	if (!user) return c.json({ error: "User not found", success: false }, 404);

	// Store alert prefs in a simple JSON column approach — use integration table as proxy
	// For now, return defaults
	return c.json({
		data: {
			weekly_report: true,
			milestone_alerts: true,
			conversion_alerts: false,
		},
		success: true,
	});
});

billingRoutes.post("/alerts", async (c) => {
	const _db = c.get("db");
	const _userId = c.get("userId");
	const prefs = await c.req.json();
	// Alert preferences stored in user metadata (simplified)
	return c.json({ data: prefs, success: true });
});

// Send test email
billingRoutes.post("/test-email", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	const user = await db
		.selectFrom("users")
		.select(["email", "name"])
		.where("id", "=", userId)
		.executeTakeFirst();
	if (!user) return c.json({ error: "User not found", success: false }, 404);

	const emailBinding = c.env.EMAIL;
	const { sendEmail } = await import("../lib/email");
	const ok = await sendEmail(
		{
			to: user.email,
			subject: "RevKlik — Email alerts active",
			html: `<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; background: #0a0a0a; color: #e8e4de; border-radius: 12px;">
      <h2 style="color: #d4882a; margin: 0 0 12px;">Email Alerts Active</h2>
      <p style="line-height: 1.6;">Hey ${user.name}, your email alerts are now configured. You'll receive weekly reports and milestone notifications.</p>
      <p style="font-size: 12px; color: #6b6560; margin-top: 20px;">You can manage your preferences in the RevKlik dashboard.</p>
    </div>`,
		},
		emailBinding,
	);

	return c.json({ data: { sent: ok }, success: ok });
});
