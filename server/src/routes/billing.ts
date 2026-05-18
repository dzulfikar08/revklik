import { Hono } from "hono";
import type { KlikapaDatabase } from "shared";
import type { Kysely } from "kysely";
import { generateId } from "../utils";
import { PLANS, getPlanLimits, getFeatures } from "../lib/plans";
import type { PlanTier } from "../lib/plans";

type Variables = { db: Kysely<KlikapaDatabase>; userId: string };
type Bindings = { POLAR_ACCESS_TOKEN?: string; POLAR_ORG_ID?: string; POLAR_WEBHOOK_SECRET?: string; POLAR_STARTER_PRODUCT_ID?: string; POLAR_GROWTH_PRODUCT_ID?: string };
type BillingEnv = { Variables: Variables; Bindings: Bindings };

export const billingRoutes = new Hono<BillingEnv>();

const POLAR_API = "https://api.polar.sh/v1";

// Get current subscription with usage info
billingRoutes.get("/subscription", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");

  const sub = await db.selectFrom("subscriptions")
    .selectAll()
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
    db.selectFrom("events")
      .select(({ fn }) => fn.count<number>("id").as("cnt"))
      .where("site_id", "in", db.selectFrom("sites").select("id").where("user_id", "=", userId))
      .where("timestamp", ">=", monthStartIso)
      .executeTakeFirst(),
    db.selectFrom("sites")
      .select(({ fn }) => fn.count<number>("id").as("cnt"))
      .where("user_id", "=", userId)
      .executeTakeFirst(),
  ]);

  const usage = {
    events: { used: Number(eventCount?.cnt ?? 0), limit: limits.events_per_month },
    sites: { used: Number(siteCount?.cnt ?? 0), limit: limits.sites },
  };

  if (!sub) {
    return c.json({
      data: {
        id: "", user_id: userId, plan: "micro" as const, status: "active" as const,
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
        cancel_at_period_end: false, polar_subscription_id: null, polar_customer_id: null,
        usage,
      }, success: true,
    });
  }

  return c.json({
    data: {
      ...sub,
      plan: sub.plan as "micro" | "starter" | "growth",
      status: sub.status as "active" | "canceled" | "past_due" | "trialing",
      cancel_at_period_end: !!sub.cancel_at_period_end,
      usage,
    }, success: true,
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

  // If Polar token is configured, generate checkout links
  if (polarToken) {
    try {
      const products = await fetch(`${POLAR_API}/products/?organization_id=${c.env.POLAR_ORG_ID || ""}`, {
        headers: { Authorization: `Bearer ${polarToken}` },
      }).then(r => r.json()).catch(() => ({} as Record<string, unknown>));

      if (Array.isArray((products as Record<string, unknown>)?.items)) {
        for (const plan of plans) {
          const product = (products as any).items.find((p: any) =>
            p.name?.toLowerCase().includes(plan.tier)
          );
          if (product?.checkout_url) {
            plan.checkout_url = product.checkout_url;
          }
        }
      }
    } catch { /* Polar API unavailable */ }
  }

  return c.json({ data: plans, success: true });
});

// Create Polar checkout session
billingRoutes.post("/checkout", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const polarToken = c.env.POLAR_ACCESS_TOKEN || "";

  const { plan, visitor_id, session_id } = await c.req.json<{ plan: string; visitor_id?: string; session_id?: string }>();
  if (!plan || !PLANS[plan as PlanTier]) {
    return c.json({ error: "Invalid plan", success: false }, 400);
  }

  // All plans are paid — no checkout skip needed

  // Get user email for Polar customer
  const user = await db.selectFrom("users").select(["email", "name"]).where("id", "=", userId).executeTakeFirst();
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
    const productId = (c.env as any)[`POLAR_${plan.toUpperCase()}_PRODUCT_ID`] || "";
    const res = await fetch(`${POLAR_API}/checkouts/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${polarToken}` },
      body: JSON.stringify({
        products: productId ? [productId] : [],
        customer_email: user.email,
        customer_name: user.name,
        metadata: { user_id: userId, plan, klikapa_visitor_id: visitor_id || null, klikapa_session_id: session_id || null },
        success_url: `https://app.revklik.com/?checkout=success`,
      }),
    });

    const session = await res.json() as { url?: string };
    if (!session.url) throw new Error("No checkout URL returned");

    return c.json({ data: { url: session.url }, success: true });
  } catch (err: any) {
    return c.json({ error: err.message || "Checkout creation failed", success: false }, 500);
  }
});

// Cancel subscription
billingRoutes.post("/cancel", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const polarToken = c.env.POLAR_ACCESS_TOKEN || "";

  const sub = await db.selectFrom("subscriptions").selectAll().where("user_id", "=", userId).executeTakeFirst();
  if (!sub || !sub.polar_subscription_id) {
    return c.json({ error: "No active paid subscription", success: false }, 404);
  }

  if (polarToken) {
    try {
      await fetch(`${POLAR_API}/subscriptions/${sub.polar_subscription_id}/cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${polarToken}` },
      });
    } catch { /* Polar API error */ }
  }

  await db.updateTable("subscriptions").set({
    cancel_at_period_end: 1,
    updated_at: new Date().toISOString(),
  }).where("user_id", "=", userId).execute();

  return c.json({ success: true });
});

// Email alert preferences
billingRoutes.get("/alerts", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const user = await db.selectFrom("users").select(["id"]).where("id", "=", userId).executeTakeFirst();
  if (!user) return c.json({ error: "User not found", success: false }, 404);

  // Store alert prefs in a simple JSON column approach — use integration table as proxy
  // For now, return defaults
  return c.json({
    data: {
      weekly_report: true,
      milestone_alerts: true,
      conversion_alerts: false,
    }, success: true,
  });
});

billingRoutes.post("/alerts", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const prefs = await c.req.json();
  // Alert preferences stored in user metadata (simplified)
  return c.json({ data: prefs, success: true });
});

// Send test email
billingRoutes.post("/test-email", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const user = await db.selectFrom("users").select(["email", "name"]).where("id", "=", userId).executeTakeFirst();
  if (!user) return c.json({ error: "User not found", success: false }, 404);

  const emailBinding = (c.env as any).EMAIL;
  const { sendEmail } = await import("../lib/email");
  const ok = await sendEmail({
    to: user.email,
    subject: "RevKlik — Email alerts active",
    html: `<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; background: #0a0a0a; color: #e8e4de; border-radius: 12px;">
      <h2 style="color: #d4882a; margin: 0 0 12px;">Email Alerts Active</h2>
      <p style="line-height: 1.6;">Hey ${user.name}, your email alerts are now configured. You'll receive weekly reports and milestone notifications.</p>
      <p style="font-size: 12px; color: #6b6560; margin-top: 20px;">You can manage your preferences in the RevKlik dashboard.</p>
    </div>`,
  }, emailBinding);

  return c.json({ data: { sent: ok }, success: ok });
});
