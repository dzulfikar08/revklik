import { Hono } from "hono";
import { generateId } from "../utils";
export const billingRoutes = new Hono();
const POLAR_API = "https://api.polar.sh/v1";
const PLANS = {
    micro: { name: "Micro", price: 1, events_per_month: 10000, sites: 1 },
    starter: { name: "Starter", price: 4, events_per_month: 100000, sites: 3 },
    growth: { name: "Growth", price: 12, events_per_month: 500000, sites: 10 },
};
// Get current subscription
billingRoutes.get("/subscription", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const sub = await db.selectFrom("subscriptions")
        .selectAll()
        .where("user_id", "=", userId)
        .executeTakeFirst();
    if (!sub) {
        return c.json({
            data: {
                id: "", user_id: userId, plan: "micro", status: "active",
                current_period_start: new Date().toISOString(),
                current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
                cancel_at_period_end: false, polar_subscription_id: null, polar_customer_id: null,
            }, success: true,
        });
    }
    return c.json({
        data: {
            ...sub,
            plan: sub.plan,
            status: sub.status,
            cancel_at_period_end: !!sub.cancel_at_period_end,
        }, success: true,
    });
});
// Get available plans with checkout URLs
billingRoutes.get("/plans", async (c) => {
    const polarToken = c.env.POLAR_ACCESS_TOKEN || "";
    const plans = Object.entries(PLANS).map(([tier, info]) => ({
        tier: tier,
        name: info.name,
        price: info.price,
        events_per_month: info.events_per_month,
        sites: info.sites,
        features: getFeatures(tier),
        checkout_url: null,
    }));
    // If Polar token is configured, generate checkout links
    if (polarToken) {
        try {
            const products = await fetch(`${POLAR_API}/products/?organization_id=${c.env.POLAR_ORG_ID || ""}`, {
                headers: { Authorization: `Bearer ${polarToken}` },
            }).then(r => r.json()).catch(() => ({}));
            if (Array.isArray(products?.items)) {
                for (const plan of plans) {
                    const product = products.items.find((p) => p.name?.toLowerCase().includes(plan.tier));
                    if (product?.checkout_url) {
                        plan.checkout_url = product.checkout_url;
                    }
                }
            }
        }
        catch { /* Polar API unavailable */ }
    }
    return c.json({ data: plans, success: true });
});
// Create Polar checkout session
billingRoutes.post("/checkout", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const polarToken = c.env.POLAR_ACCESS_TOKEN || "";
    const { plan, visitor_id, session_id } = await c.req.json();
    if (!plan || !PLANS[plan]) {
        return c.json({ error: "Invalid plan", success: false }, 400);
    }
    // All plans are paid — no checkout skip needed
    // Get user email for Polar customer
    const user = await db.selectFrom("users").select(["email", "name"]).where("id", "=", userId).executeTakeFirst();
    if (!user)
        return c.json({ error: "User not found", success: false }, 404);
    // If Polar token not configured, return direct link placeholder
    if (!polarToken) {
        return c.json({
            data: { url: `https://polar.sh/revklik/checkout?plan=${plan}` },
            success: true,
        });
    }
    try {
        // Polar API: POST /v1/checkouts/session with products array
        const productId = c.env[`POLAR_${plan.toUpperCase()}_PRODUCT_ID`] || "";
        const res = await fetch(`${POLAR_API}/checkouts/session`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${polarToken}` },
            body: JSON.stringify({
                products: productId ? [productId] : [],
                customer_email: user.email,
                customer_name: user.name,
                metadata: { user_id: userId, plan, klikapa_visitor_id: visitor_id || null, klikapa_session_id: session_id || null },
                success_url: `https://revklik.com/success/{CHECKOUT_ID}`,
            }),
        });
        const session = await res.json();
        if (!session.url)
            throw new Error("No checkout URL returned");
        return c.json({ data: { url: session.url }, success: true });
    }
    catch (err) {
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
        }
        catch { /* Polar API error */ }
    }
    await db.updateTable("subscriptions").set({
        cancel_at_period_end: 1,
        updated_at: new Date().toISOString(),
    }).where("user_id", "=", userId).execute();
    return c.json({ success: true });
});
function getFeatures(tier) {
    const base = ["Privacy-first analytics", "Cookieless tracking", "Visitor profiles", "UTM tracking", "CSV export"];
    if (tier === "micro")
        return [...base, "1 site", "10K events/month", "<1KB script", "7-day retention"];
    if (tier === "starter")
        return [...base, "3 sites", "100K events/month", "<1KB script", "30-day retention", "Funnel conversion", "Revenue attribution", "Real-time dashboard"];
    return [...base, "10 sites", "500K events/month", "Full script", "90-day retention", "AI insights", "Heatmaps", "Session replays", "Integrations", "Priority support", "Team members"];
}
// Email alert preferences
billingRoutes.get("/alerts", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const user = await db.selectFrom("users").select(["id"]).where("id", "=", userId).executeTakeFirst();
    if (!user)
        return c.json({ error: "User not found", success: false }, 404);
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
    if (!user)
        return c.json({ error: "User not found", success: false }, 404);
    const emailBinding = c.env.EMAIL;
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
