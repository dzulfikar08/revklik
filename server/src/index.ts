import { Hono } from "hono";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import type { KlikapaDatabase } from "shared";
import type { Kysely } from "kysely";
import { createDb } from "./db";
import { sql } from "./db";
import { migrateDatabase } from "./migrations";
import { trackRoutes } from "./routes/track";
import { siteRoutes } from "./routes/sites";
import { analyticsRoutes } from "./routes/analytics";
import { aiInsightsRoutes } from "./routes/ai-insights";
import { integrationRoutes } from "./routes/integrations";
import { webhookRoutes } from "./routes/webhooks";
import { midtransWebhookRoutes } from "./routes/webhooks-midtrans";
import { xenditWebhookRoutes } from "./routes/webhooks-xendit";
import { stripeWebhookRoutes } from "./routes/webhooks-stripe";
import { lemonsqueezyWebhookRoutes } from "./routes/webhooks-lemonsqueezy";
import { paymentProviderRoutes } from "./routes/payment-providers";
import { billingRoutes } from "./routes/billing";
import { teamRoutes } from "./routes/team";
import { pushTokenRoutes } from "./routes/push-tokens";
import { widgetRoutes } from "./routes/widgets";
import { docsRoutes } from "./routes/docs";
import { tokenRoutes } from "./routes/tokens";
import { v1Routes } from "./routes/v1";
import { segmentRoutes } from "./routes/segments";
import { annotationRoutes } from "./routes/annotations";
import { emailReportRoutes } from "./routes/email-reports";
import { shareRoutes } from "./routes/share";
import { gscRoutes } from "./routes/gsc";
import { predictionsRoutes } from "./routes/predictions";
import { affiliateRoutes } from "./routes/affiliates";
import { shopeeRoutes } from "./routes/marketplace-shopee";
import { tokopediaRoutes } from "./routes/marketplace-tokopedia";
import { hashPassword, generateId, generateApiKey, hashToken } from "./utils";

type Bindings = { DB: D1Database; POLAR_ACCESS_TOKEN?: string; POLAR_ORG_ID?: string; POLAR_WEBHOOK_SECRET?: string };
type Variables = { db: Kysely<KlikapaDatabase>; userId: string };
type Env = { Bindings: Bindings; Variables: Variables };

/** Process a single Polar order — creates conversion event + upserts visitor profile. Deduplicates by visitor_id. */
async function processPolarOrder(db: Kysely<KlikapaDatabase>, order: any, siteId: string): Promise<"imported" | "skipped" | "refunded"> {
  const polarOrderId = order.id;
  const visitorId = `polar_${polarOrderId.replace(/[^a-zA-Z0-9]/g, "_")}`;

  const existing = await db.selectFrom("events").select(["id", "revenue", "props"]).where("site_id", "=", siteId).where("visitor_id", "=", visitorId).executeTakeFirst();
  if (existing) {
    // If order was refunded, update existing event revenue to 0
    if (order.status === "refunded" && existing.revenue) {
      await db.updateTable("events").set({ revenue: 0, props: JSON.stringify({ ...(existing.props ? JSON.parse(existing.props as string) : {}), refunded: true }) }).where("id", "=", existing.id).execute();
      return "refunded";
    }
    return "skipped";
  }

  const isRefund = order.status === "refunded";
  const amount = isRefund ? 0 : (order.total_amount ?? 0) / 100;
  const country = order.customer?.billing_address?.country ?? order.billing_address?.country ?? null;
  const customerEmail = order.customer?.email ?? null;
  const customerName = order.customer?.name ?? order.billing_name ?? null;
  const ts = order.created_at ?? new Date().toISOString();
  const productName = order.product?.name ?? null;
  const billingReason = order.billing_reason ?? "purchase";
  const isRecurring = ["subscription_create", "subscription_cycle", "subscription_update"].includes(billingReason);

  await db.insertInto("events").values({
    id: generateId(), site_id: siteId, session_id: generateId(), visitor_id: visitorId,
    timestamp: ts, event_type: "conversion",
    name: isRecurring ? "subscription_payment" : "one_time_purchase",
    path: "/purchase", hostname: null, referrer: null,
    utm_source: null, utm_medium: null, utm_campaign: null, utm_term: null, utm_content: null,
    country, region: order.billing_address?.state ?? null, city: order.billing_address?.city ?? null,
    device_type: null, browser: null, os: null, revenue: amount,
    props: JSON.stringify({ polar_order_id: polarOrderId, currency: order.currency ?? "usd", customer_email: customerEmail, customer_name: customerName, product_name: productName, billing_reason: billingReason, source: "polar_sync" }),
    fingerprint: null,
  }).execute();

  await db.insertInto("visitor_profiles").values({
    id: generateId(), site_id: siteId, visitor_id: visitorId, name: customerName, email: customerEmail,
    first_seen: ts, last_seen: ts, country, region: order.billing_address?.state ?? null, city: order.billing_address?.city ?? null,
    device_type: null, browser: null, os: null, total_sessions: 0, total_pageviews: 0, total_revenue: amount, fingerprint: null,
  }).onConflict((oc) => oc.columns(["site_id", "visitor_id"]).doUpdateSet({
    last_seen: ts, total_revenue: sql`total_revenue + ${amount}`,
  })).execute();

  return "imported";
}

const authMiddleware = createMiddleware<Env>(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return c.json({ error: "Unauthorized", success: false }, 401);

  const token = authHeader.slice(7);
  const db = c.get("db");
  if (!db) return c.json({ error: "Database unavailable", success: false }, 503);

  const keyHash = await hashToken(token);
  const apiKey = await db.selectFrom("api_keys").select(["user_id"]).where("key_hash", "=", keyHash).executeTakeFirst();
  if (!apiKey) return c.json({ error: "Invalid token", success: false }, 401);

  c.set("userId", apiKey.user_id);
  await next();
});

const adminMiddleware = createMiddleware<Env>(async (c, next) => {
  const userId = c.get("userId");
  const db = c.get("db");
  if (!db) return c.json({ error: "Database unavailable", success: false }, 503);
  const user = await db.selectFrom("users").select(["role"]).where("id", "=", userId).executeTakeFirst();
  if (!user || user.role !== "super_admin") return c.json({ error: "Forbidden", success: false }, 403);
  await next();
});

const app = new Hono<Env>().basePath("/api");
app.use(cors());

app.get("/", (c) => c.json({ message: "klikapa", version: "0.7.0", success: true }));
app.get("/health", (c) => c.json({ status: "ok", success: true }));
app.route("/docs", docsRoutes);

app.use(async (c, next) => {
  try {
    const d1 = c.env.DB;
    if (d1) {
      await migrateDatabase(d1);
      c.set("db", createDb(d1));
    }
  } catch (err) {
    console.error("Migration error:", err);
  }
  await next();
});

app.route("/", trackRoutes);

// Public API v1 (uses rvt_ and rv_ tokens, not kp_ session tokens)
app.route("/v1", v1Routes);

app.post("/auth/register", async (c) => {
  const db = c.get("db");
  if (!db) return c.json({ error: "DB unavailable", success: false }, 503);
  const { name, email, password } = await c.req.json();
  if (!name || !email || !password) return c.json({ error: "All fields required", success: false }, 400);

  const existing = await db.selectFrom("users").select(["id"]).where("email", "=", email).executeTakeFirst();
  if (existing) return c.json({ error: "Email taken", success: false }, 409);

  const superAdminEmail = (c.env as any).SUPER_ADMIN_EMAIL || "";
  const userId = generateId();
  await db.insertInto("users").values({
    id: userId, email, password_hash: await hashPassword(password), name,
    role: email === superAdminEmail ? "super_admin" : "user",
    created_at: new Date().toISOString(),
  }).execute();
  const { key, prefix } = generateApiKey("session");
  await db.insertInto("api_keys").values({ id: generateId(), user_id: userId, key_hash: await hashToken(key), key_prefix: prefix, name: "default", token_type: "session", scopes: null, site_id: null, last_used_at: null, expires_at: null, created_at: new Date().toISOString() }).execute();

  // Referral tracking: check for ref code in query or body
  const refCode = c.req.query("ref");
  if (refCode) {
    try {
      const affiliate = await db.selectFrom("affiliates").select(["id", "commission_rate"]).where("referral_code", "=", refCode).executeTakeFirst();
      if (affiliate) {
        await db.insertInto("referrals").values({
          id: generateId(),
          affiliate_id: affiliate.id,
          referred_user_id: userId,
          event: "signup",
          commission_amount: 0,
          status: "confirmed",
          created_at: new Date().toISOString(),
        }).execute();
      }
    } catch { /* referral tracking failure should not block registration */ }
  }

  return c.json({ data: { user: { id: userId, name, email }, token: key }, success: true }, 201);
});

app.post("/auth/login", async (c) => {
  const db = c.get("db");
  if (!db) return c.json({ error: "DB unavailable", success: false }, 503);
  const { email, password } = await c.req.json();
  const user = await db.selectFrom("users").select(["id", "name", "email", "password_hash"]).where("email", "=", email).executeTakeFirst();
  if (!user || (await hashPassword(password)) !== user.password_hash) return c.json({ error: "Invalid credentials", success: false }, 401);

  const { key } = generateApiKey("session");
  await db.insertInto("api_keys").values({ id: generateId(), user_id: user.id, key_hash: await hashToken(key), key_prefix: key.slice(0, 7), name: "session", token_type: "session", scopes: null, site_id: null, last_used_at: null, expires_at: null, created_at: new Date().toISOString() }).execute();
  return c.json({ data: { user: { id: user.id, name: user.name, email: user.email }, token: key }, success: true });
});

// Google OAuth
app.get("/auth/google", (c) => {
  const clientId = (c.env as any).GOOGLE_CLIENT_ID || "";
  const redirectUri = `${new URL(c.req.url).origin}/api/auth/google/callback`;
  const state = crypto.randomUUID();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "offline",
    prompt: "consent",
  });
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

app.get("/auth/google/callback", async (c) => {
  const db = c.get("db");
  if (!db) return c.json({ error: "DB unavailable", success: false }, 503);

  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code || !state) return c.json({ error: "Missing code or state", success: false }, 400);

  const clientId = (c.env as any).GOOGLE_CLIENT_ID || "";
  const clientSecret = (c.env as any).GOOGLE_CLIENT_SECRET || "";
  const redirectUri = `${new URL(c.req.url).origin}/api/auth/google/callback`;

  // Exchange code for tokens
  let tokenRes: any;
  try {
    const tr = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
    });
    tokenRes = await tr.json();
  } catch { return c.json({ error: "OAuth token exchange failed", success: false }, 500); }
  if (tokenRes.error) return c.json({ error: tokenRes.error_description || tokenRes.error, success: false }, 400);

  // Get user profile
  let profile: any;
  try {
    const pr = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokenRes.access_token}` },
    });
    profile = await pr.json();
  } catch { return c.json({ error: "Failed to get profile", success: false }, 500); }
  if (!profile.email) return c.json({ error: "No email from Google", success: false }, 400);

  const superAdminEmail = (c.env as any).SUPER_ADMIN_EMAIL || "";
  const isSuperAdmin = profile.email === superAdminEmail;

  // Find existing user by google_id or email
  const existingByGoogle = profile.sub ? await db.selectFrom("users").selectAll().where("google_id", "=", profile.sub).executeTakeFirst() : null;
  const existingByEmail = await db.selectFrom("users").selectAll().where("email", "=", profile.email).executeTakeFirst();
  const existingUser = existingByGoogle || existingByEmail;

  let userId: string;
  if (existingUser) {
    userId = existingUser.id;
    // Link google_id if logging in by email for the first time
    if (!existingUser.google_id && profile.sub) {
      await db.updateTable("users").set({ google_id: profile.sub, avatar_url: profile.picture || existingUser.avatar_url }).where("id", "=", userId).execute();
    }
    // Promote to super_admin if email matches
    if (isSuperAdmin && existingUser.role !== "super_admin") {
      await db.updateTable("users").set({ role: "super_admin" }).where("id", "=", userId).execute();
    }
  } else {
    userId = generateId();
    await db.insertInto("users").values({
      id: userId,
      email: profile.email,
      name: profile.name || profile.email.split("@")[0],
      password_hash: "",
      google_id: profile.sub || null,
      avatar_url: profile.picture || null,
      role: isSuperAdmin ? "super_admin" : "user",
      created_at: new Date().toISOString(),
    }).execute();
  }

  // Issue API key
  const { key } = generateApiKey("session");
  await db.insertInto("api_keys").values({
    id: generateId(),
    user_id: userId,
    key_hash: await hashToken(key),
    key_prefix: key.slice(0, 7),
    name: "session",
    token_type: "session",
    scopes: null,
    site_id: null,
    last_used_at: null,
    expires_at: null,
    created_at: new Date().toISOString(),
  }).execute();

  // Redirect to app with token
  const appUrl = `${new URL(c.req.url).origin}/#token=${encodeURIComponent(key)}`;
  return c.redirect(appUrl);
});

app.use("/sites/*", authMiddleware);
app.route("/sites", siteRoutes);

app.use("/analytics/*", authMiddleware);
app.route("/analytics", analyticsRoutes);

app.use("/ai-insights/*", authMiddleware);
app.route("/ai-insights", aiInsightsRoutes);

app.use("/integrations/*", authMiddleware);
app.route("/integrations", integrationRoutes);

app.use("/tokens/*", authMiddleware);
app.route("/tokens", tokenRoutes);

app.route("/webhooks", webhookRoutes);
app.route("/webhooks/midtrans", midtransWebhookRoutes);
app.route("/webhooks/xendit", xenditWebhookRoutes);
app.route("/webhooks/stripe", stripeWebhookRoutes);
app.route("/webhooks/lemonsqueezy", lemonsqueezyWebhookRoutes);

app.use("/payment-providers/*", authMiddleware);
app.route("/payment-providers", paymentProviderRoutes);

// Serve tracking script based on site plan tier
app.get("/klikapa.js", async (c) => {
  const referer = c.req.header("Referer") || "";
  let siteId = "";
  try { siteId = new URL(referer).searchParams.get("site_id") || ""; } catch {}
  siteId = siteId || c.req.query("site_id") || "";

  let isFull = false;
  if (siteId) {
    try {
      const d1 = c.env.DB;
      if (d1) {
        const db = createDb(d1);
        const site = await db.selectFrom("sites")
          .select(["id", "user_id"])
          .where("id", "=", siteId)
          .executeTakeFirst();
        if (site) {
          const sub = await db.selectFrom("subscriptions")
            .select(["plan"])
            .where("user_id", "=", site.user_id)
            .executeTakeFirst();
          if (sub && sub.plan === "growth") isFull = true;
        }
      }
    } catch { /* default to core */ }
  }

  const base = new URL(c.req.url).origin;
  return c.redirect(isFull ? `${base}/klikapa-full.js` : `${base}/klikapa-core.js`, 302);
});

// Billing webhook (no auth — Polar calls this)
app.post("/billing/webhook", async (c) => {
  const d1 = c.env.DB;
  if (!d1) return c.json({ error: "DB unavailable" }, 503);
  const db = createDb(d1);
  const body = await c.req.text();

  // Verify Polar webhook signature using standardwebhooks format
  const secret = (c.env as any).POLAR_WEBHOOK_SECRET || "";
  if (secret) {
    const webhookId = c.req.header("webhook-id") || "";
    const webhookTs = c.req.header("webhook-timestamp") || "";
    const webhookSig = c.req.header("webhook-signature") || "";
    if (!webhookId || !webhookTs || !webhookSig) {
      return c.json({ error: "Missing webhook headers" }, 401);
    }
    // standardwebhooks: signed_payload = "${webhook_id}.${webhook_timestamp}.${body}"
    const signedPayload = `${webhookId}.${webhookTs}.${body}`;
    const enc = new TextEncoder();
    // Secret is base64-encoded (strip whsec_ prefix if present)
    const rawSecret = secret.startsWith("whsec_") ? secret.slice(7) : secret;
    const secretBytes = Uint8Array.from(atob(rawSecret), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("raw", secretBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(signedPayload));
    const computedSig = "v1," + btoa(String.fromCharCode(...new Uint8Array(sig)));
    // Compare against any signature in the header (space-separated)
    const sigs = webhookSig.split(" ");
    let valid = false;
    for (const s of sigs) {
      let r = 0;
      const a = computedSig, b = s.startsWith("v1,") ? s : "v1," + s;
      const maxLen = Math.max(a.length, b.length);
      for (let i = 0; i < maxLen; i++) r |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
      if (r === 0) { valid = true; break; }
    }
    if (!valid) return c.json({ error: "Invalid signature" }, 401);
  }

  try {
    const event = JSON.parse(body);
    // Polar webhook types: subscription.created, subscription.active, subscription.canceled, etc.
    const eventType = event.type;
    const data = event.data;
    // Metadata can be at top level (from checkout) or in data
    let userId = data?.metadata?.user_id || event.metadata?.user_id;
    const plan = data?.metadata?.plan || event.metadata?.plan;

    // Fallback: match user by customer email (direct checkout links have no metadata)
    if (!userId) {
      const customerEmail = data?.customer?.email || data?.customer_email;
      if (customerEmail) {
        const matched = await db.selectFrom("users").select(["id"]).where("email", "=", customerEmail).executeTakeFirst();
        if (matched) userId = matched.id;
      }
    }

    if (!userId) return c.json({ error: "Missing user_id" }, 400);

    if (eventType === "checkout.created" || eventType === "subscription.created" || eventType === "subscription.active" || eventType === "subscription.updated") {
      await db.insertInto("subscriptions").values({
        id: generateId(), user_id: userId, plan: plan || "starter",
        status: data?.status || "active",
        current_period_start: data?.current_period_start || new Date().toISOString(),
        current_period_end: data?.current_period_end || new Date(Date.now() + 30 * 86400000).toISOString(),
        cancel_at_period_end: 0, polar_subscription_id: data?.id || null, polar_customer_id: data?.customer_id || null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).onConflict((oc) => oc.column("user_id").doUpdateSet({
        plan: plan || "starter", status: data?.status || "active",
        current_period_end: data?.current_period_end || undefined,
        polar_subscription_id: data?.id || undefined,
        polar_customer_id: data?.customer_id || undefined,
        updated_at: new Date().toISOString(),
      })).execute();

      // Revenue attribution: create conversion event from checkout metadata
      const visitorId = data?.metadata?.klikapa_visitor_id;
      const sessionId = data?.metadata?.klikapa_session_id;
      if (visitorId && plan && plan !== "free") {
        const userSites = await db.selectFrom("sites").select(["id"])
          .where("user_id", "=", userId).limit(1).execute();
        const siteId = userSites[0]?.id;
        if (siteId) {
          const planPrice = plan === "growth" ? 12 : 4;
          const ts = new Date().toISOString();
          await db.insertInto("events").values({
            id: generateId(), site_id: siteId, session_id: sessionId || generateId(),
            visitor_id: visitorId, timestamp: ts, event_type: "conversion",
            name: "subscription_payment", path: "/billing/checkout", hostname: null,
            referrer: null, utm_source: null, utm_medium: null, utm_campaign: null,
            utm_term: null, utm_content: null, country: null, region: null, city: null,
            device_type: null, browser: null, os: null,
            revenue: planPrice,
            props: JSON.stringify({ plan, polar_subscription_id: data?.id, source: "polar_webhook" }),
            fingerprint: null,
          }).execute();
          await db.insertInto("visitor_profiles").values({
            id: generateId(), site_id: siteId, visitor_id: visitorId,
            first_seen: ts, last_seen: ts, country: null, region: null, city: null,
            device_type: null, browser: null, os: null,
            total_sessions: 0, total_pageviews: 0, total_revenue: planPrice, fingerprint: null,
          }).onConflict((oc) => oc.columns(["site_id", "visitor_id"]).doUpdateSet({
            last_seen: ts,
            total_revenue: sql`total_revenue + ${planPrice}`,
          })).execute();
        }
      }
    } else if (eventType === "order.paid" || eventType === "order.refunded") {
      // Order events — process using shared helper
      const order = data;
      const customerEmail = order?.customer?.email || order?.customer_email;
      let orderUserId = order?.metadata?.user_id || userId;

      // Resolve user from customer email if no user_id
      if (!orderUserId && customerEmail) {
        const matched = await db.selectFrom("users").select(["id"]).where("email", "=", customerEmail).executeTakeFirst();
        if (matched) orderUserId = matched.id;
      }
      if (!orderUserId) return c.json({ error: "Cannot resolve user for order" }, 400);

      // Find user's first site to attribute revenue
      const userSites = await db.selectFrom("sites").select(["id"]).where("user_id", "=", orderUserId).limit(1).execute();
      const siteId = userSites[0]?.id;
      if (!siteId) return c.json({ error: "No site found for user" }, 404);

      const result = await processPolarOrder(db, order, siteId);
      return c.json({ success: true, result });
    } else if (eventType === "subscription.canceled") {
      await db.updateTable("subscriptions").set({ cancel_at_period_end: 1, status: "canceled", updated_at: new Date().toISOString() }).where("user_id", "=", userId).execute();
    }
    return c.json({ success: true });
  } catch (err: any) { return c.json({ error: err.message }, 500); }
});

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
app.get("/public/:token", async (c) => {
  const d1 = c.env.DB;
  if (!d1) return c.json({ error: "DB unavailable", success: false }, 503);
  try { await migrateDatabase(d1); } catch {}
  c.set("db", createDb(d1));

  const token = c.req.param("token");
  const db = c.get("db") as Kysely<KlikapaDatabase>;
  const site = await db.selectFrom("sites").select(["id", "name", "domain", "public_dashboard"])
    .where("share_token", "=", token).where("public_dashboard", "=", 1).executeTakeFirst();
  if (!site) return c.json({ error: "Dashboard not found", success: false }, 404);

  const { getDateRange } = await import("./utils");
  const range = c.req.query("range") || "7d";
  const { start } = getDateRange(range);
  const startIso = start.toISOString();

  const { getOverviewStats, getTimeseries, getTopPages, getReferrers, getDeviceBreakdown, getRevenueBySource, getRevenueByCountry, getRevenueTimeseries, getChannelBreakdown } = await import("./queries/analytics");
  const [stats, timeseries, topPages, sources, { devices, os, browsers }, revenueBySource, revenueByCountry, revenueTimeseries, channels] = await Promise.all([
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

  return c.json({ data: { site: { name: site.name, domain: site.domain }, dashboard: { stats, timeseries, topPages, sources, devices, os, browsers, revenueBySource, revenueByCountry, revenueTimeseries, channels } }, success: true });
});

app.route("/widget-data", widgetRoutes);

// Import routes (regular auth — any authenticated user can import to their own sites)
app.use("/import/*", authMiddleware);

app.post("/import/polar-orders", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  if (!db) return c.json({ error: "DB unavailable", success: false }, 503);
  const body = await c.req.json();
  const { site_id, polar_token, polar_org_id } = body;
  const polarToken = polar_token || (c.env as any).POLAR_ACCESS_TOKEN || "";
  const polarOrgId = polar_org_id || (c.env as any).POLAR_ORG_ID || "";
  if (!site_id) return c.json({ error: "site_id required", success: false }, 400);
  if (!polarToken) return c.json({ error: "Polar access token required — enter your token above or set POLAR_ACCESS_TOKEN env var", success: false }, 400);
  if (!polarOrgId) return c.json({ error: "Polar organization ID required — set POLAR_ORG_ID env var or pass it in the request", success: false }, 400);

  // Validate user owns this site
  const site = await db.selectFrom("sites").select(["id"]).where("id", "=", site_id)
    .where((eb) => eb.or([eb("user_id", "=", userId), eb.exists(eb.selectFrom("team_members").select("id").where("site_id", "=", site_id).where("user_id", "=", userId).where("accepted_at", "is not", null))]))
    .executeTakeFirst();
  if (!site) return c.json({ error: "Site not found", success: false }, 404);

  let imported = 0;
  let skipped = 0;
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const res = await fetch(`https://api.polar.sh/v1/orders?organization_id=${polarOrgId}&page=${page}&limit=100&sorting=-created_at`, {
      headers: { Authorization: `Bearer ${polarToken}`, "Content-Type": "application/json" },
    });
    if (!res.ok) {
      const errText = await res.text();
      return c.json({ error: `Polar API error: ${res.status} ${errText}`, success: false }, 502);
    }
    const rawBody = await res.text();
    let data: any;
    try { data = JSON.parse(rawBody); } catch { return c.json({ error: `Polar API returned non-JSON: ${rawBody.slice(0, 200)}`, success: false }, 502); }
    const orders: any[] = data.items ?? data.data?.items ?? data.result?.items ?? (Array.isArray(data.data) ? data.data : []);
    const pagination = data.pagination ?? data.data?.pagination ?? data.meta ?? {};
    hasMore = page < (pagination.max_page ?? pagination.total_pages ?? 1);
    if (page === 1 && orders.length === 0) {
      return c.json({ success: true, data: { imported, skipped, debug: { status: res.status, keys: Object.keys(data), sample: JSON.stringify(data).slice(0, 500) } } });
    }

    for (const order of orders) {
      if (order.status !== "paid") { skipped++; continue; }
      const result = await processPolarOrder(db, order, site_id);
      if (result === "imported") imported++;
      else skipped++;
    }
    page++;
  }
  return c.json({ success: true, data: { imported, skipped } });
});

app.post("/import/onedollarstats", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  if (!db) return c.json({ error: "DB unavailable", success: false }, 503);
  const body = await c.req.json();
  const { site_id, api_key, ods_site_id, date_range } = body;
  if (!site_id || !api_key || !ods_site_id) return c.json({ error: "site_id, api_key, and ods_site_id required", success: false }, 400);

  const site = await db.selectFrom("sites").select(["id"]).where("id", "=", site_id)
    .where((eb) => eb.or([eb("user_id", "=", userId), eb.exists(eb.selectFrom("team_members").select("id").where("site_id", "=", site_id).where("user_id", "=", userId).where("accepted_at", "is not", null))]))
    .executeTakeFirst();
  if (!site) return c.json({ error: "Site not found", success: false }, 404);

  const range = date_range || "all";
  let imported = 0;

  const pageQuery = { site_id: ods_site_id, metrics: ["visitors", "pageviews"], date_range: range, dimensions: ["time:day", "event:page"], order_by: [["time:day", "asc"]], pagination: { limit: 10000 } };
  const pageRes = await fetch("https://api.onedollarstats.com/api", {
    method: "POST", headers: { "x-api-key": api_key, "Content-Type": "application/json" }, body: JSON.stringify(pageQuery),
  });
  if (!pageRes.ok) return c.json({ error: `OneDollarStats API error: ${pageRes.status}`, success: false }, 502);
  const pageData = await pageRes.json() as { results: Array<{ metrics: number[]; dimensions: string[] }> };

  const countryQuery = { site_id: ods_site_id, metrics: ["visitors"], date_range: range, dimensions: ["time:day", "visit:country_name"], order_by: [["time:day", "asc"]], pagination: { limit: 10000 } };
  const countryRes = await fetch("https://api.onedollarstats.com/api", {
    method: "POST", headers: { "x-api-key": api_key, "Content-Type": "application/json" }, body: JSON.stringify(countryQuery),
  });
  const countryData = countryRes.ok ? await countryRes.json() as { results: Array<{ metrics: number[]; dimensions: string[] }> } : { results: [] };

  const sourceQuery = { site_id: ods_site_id, metrics: ["visitors"], date_range: range, dimensions: ["time:day", "visit:source"], order_by: [["time:day", "asc"]], pagination: { limit: 10000 } };
  const sourceRes = await fetch("https://api.onedollarstats.com/api", {
    method: "POST", headers: { "x-api-key": api_key, "Content-Type": "application/json" }, body: JSON.stringify(sourceQuery),
  });
  const sourceData = sourceRes.ok ? await sourceRes.json() as { results: Array<{ metrics: number[]; dimensions: string[] }> } : { results: [] };

  const countryByDate = new Map<string, Map<string, number>>();
  for (const row of countryData.results) {
    const [date, country] = row.dimensions as [string, string];
    if (!country) continue;
    if (!countryByDate.has(date)) countryByDate.set(date, new Map());
    countryByDate.get(date)!.set(country, row.metrics[0] ?? 0);
  }

  const sourceByDate = new Map<string, Map<string, number>>();
  for (const row of sourceData.results) {
    const [date, source] = row.dimensions as [string, string];
    if (!source || source === "(not set)") continue;
    if (!sourceByDate.has(date)) sourceByDate.set(date, new Map());
    sourceByDate.get(date)!.set(source, row.metrics[0] ?? 0);
  }

  const countryToCode: Record<string, string> = { "United States": "US", "United States of America": "US", "Netherlands": "NL", "Czech Republic": "CZ", "Czechia": "CZ", "Germany": "DE", "United Kingdom": "GB", "France": "FR", "Japan": "JP", "Canada": "CA", "Australia": "AU", "Brazil": "BR", "India": "IN", "Indonesia": "ID", "Russia": "RU", "China": "CN", "South Korea": "KR", "Spain": "ES", "Italy": "IT", "Poland": "PL", "Sweden": "SE", "Norway": "NO", "Finland": "FI", "Denmark": "DK", "Turkey": "TR", "Mexico": "MX", "Argentina": "AR", "Singapore": "SG", "Ukraine": "UA", "Belgium": "BE", "Switzerland": "CH", "Austria": "AT", "Portugal": "PT", "Ireland": "IE", "Israel": "IL", "Thailand": "TH", "Philippines": "PH", "Vietnam": "VN", "Malaysia": "MY", "Colombia": "CO", "Chile": "CL", "South Africa": "ZA", "New Zealand": "NZ", "Taiwan": "TW", "Hong Kong": "HK", "Romania": "RO", "Greece": "GR", "Hungary": "HU" };

  for (const row of pageData.results) {
    const [date, page] = row.dimensions as [string, string | undefined];
    const pagePath = page || "/";
    const visitors = row.metrics[0];
    if (!visitors || visitors < 1) continue;

    const dayCountries = countryByDate.get(date) ?? new Map();
    const daySources = sourceByDate.get(date) ?? new Map();
    const totalCountryVisitors = [...dayCountries.values()].reduce((s, v) => s + v, 0) || visitors;
    const eventsToCreate = Math.min(visitors, 50);

    for (let i = 0; i < eventsToCreate; i++) {
      let country: string | null = null;
      if (dayCountries.size > 0) {
        let target = (i / eventsToCreate) * totalCountryVisitors;
        for (const [c, v] of dayCountries) { target -= v; if (target <= 0) { country = countryToCode[c] || c.substring(0, 2).toUpperCase(); break; } }
      }
      let referrer: string | null = null;
      const totalSourceVisitors = [...daySources.values()].reduce((s, v) => s + v, 0) || 1;
      if (daySources.size > 0) {
        let target = (i / eventsToCreate) * totalSourceVisitors;
        for (const [s, v] of daySources) { target -= v; if (target <= 0) { referrer = s; break; } }
      }
      const visitorId = `ods_${date}_${pagePath.replace(/[^a-zA-Z0-9]/g, "_")}_${i}`;
      const ts = `${date}T${String(12 + (i % 8)).padStart(2, "0")}:00:00Z`;
      await db.insertInto("events").values({
        id: generateId(), site_id, session_id: generateId(), visitor_id: visitorId,
        timestamp: ts, event_type: "pageview", name: null, path: pagePath,
        hostname: null, referrer, utm_source: null, utm_medium: null, utm_campaign: null,
        utm_term: null, utm_content: null, country, region: null, city: null,
        device_type: null, browser: null, os: null, revenue: null,
        props: JSON.stringify({ source: "onedollarstats_import", ods_visitors: visitors, ods_pageviews: row.metrics[1] }),
        fingerprint: null,
      }).execute();
      imported++;
    }
  }
  return c.json({ success: true, data: { imported, note: "Created synthetic pageview events from aggregated ODS data" } });
});

// Admin routes (super_admin only)
app.use("/admin/*", authMiddleware);
app.use("/admin/*", adminMiddleware);

app.get("/admin/stats", async (c) => {
  const db = c.get("db");
  if (!db) return c.json({ error: "DB unavailable", success: false }, 503);
  const [users, sites, events, subscriptions] = await Promise.all([
    db.selectFrom("users").select(({ fn }) => [fn.count<number>("id").as("count")]).executeTakeFirst(),
    db.selectFrom("sites").select(({ fn }) => [fn.count<number>("id").as("count")]).executeTakeFirst(),
    db.selectFrom("events").select(({ fn }) => [fn.count<number>("id").as("count")]).executeTakeFirst(),
    db.selectFrom("subscriptions").select(({ fn }) => [fn.count<number>("id").as("count")]).where("status", "=", "active").executeTakeFirst(),
  ]);
  return c.json({ data: { users: Number(users?.count ?? 0), sites: Number(sites?.count ?? 0), events: Number(events?.count ?? 0), activeSubscriptions: Number(subscriptions?.count ?? 0) }, success: true });
});

app.get("/admin/users", async (c) => {
  const db = c.get("db");
  if (!db) return c.json({ error: "DB unavailable", success: false }, 503);
  const users = await db.selectFrom("users").select(["id", "email", "name", "role", "google_id", "created_at"])
    .orderBy("created_at", "desc").limit(200).execute();
  return c.json({ data: users, success: true });
});

app.patch("/admin/users/:id", async (c) => {
  const db = c.get("db");
  if (!db) return c.json({ error: "DB unavailable", success: false }, 503);
  const targetId = c.req.param("id");
  const body = await c.req.json();
  const updates: Record<string, unknown> = {};
  if (body.role !== undefined) updates.role = body.role;
  if (body.plan !== undefined) {
    // Upsert subscription plan
    await db.insertInto("subscriptions").values({
      id: generateId(), user_id: targetId, plan: body.plan, status: "active",
      current_period_start: new Date().toISOString(),
      current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
      cancel_at_period_end: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).onConflict((oc) => oc.column("user_id").doUpdateSet({
      plan: body.plan, updated_at: new Date().toISOString(),
    })).execute();
  }
  if (Object.keys(updates).length > 0) {
    await db.updateTable("users").set(updates).where("id", "=", targetId).execute();
  }
  return c.json({ success: true });
});

app.onError((err, c) => {
  console.error("Server error:", err);
  return c.json({ error: err.message, success: false }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Bindings & Record<string, any>, ctx: ExecutionContext) {
    const polarToken = env.POLAR_ACCESS_TOKEN || "";
    const polarOrgId = env.POLAR_ORG_ID || "";
    if (!polarToken || !polarOrgId || !env.DB) {
      console.error("Polar cron sync: missing POLAR_ACCESS_TOKEN, POLAR_ORG_ID, or DB binding");
      return;
    }

    const db = createDb(env.DB);
    // Fetch orders from last 7 days to catch missed webhooks
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    let page = 1;
    let hasMore = true;
    let synced = 0;

    while (hasMore) {
      try {
        const res = await fetch(`https://api.polar.sh/v1/orders?organization_id=${polarOrgId}&page=${page}&limit=100&sorting=-created_at&since=${encodeURIComponent(sevenDaysAgo)}`, {
          headers: { Authorization: `Bearer ${polarToken}`, "Content-Type": "application/json" },
        });
        if (!res.ok) { console.error(`Polar cron sync API error: ${res.status}`); break; }

        const data: any = await res.json();
        const orders: any[] = data.items ?? data.data?.items ?? data.result?.items ?? (Array.isArray(data.data) ? data.data : []);
        const pagination = data.pagination ?? data.data?.pagination ?? data.meta ?? {};
        hasMore = page < (pagination.max_page ?? pagination.total_pages ?? 1);

        for (const order of orders) {
          if (order.status !== "paid") continue;
          // Resolve user by customer email, then find their site
          const customerEmail = order.customer?.email || order.customer_email;
          if (!customerEmail) continue;
          const user = await db.selectFrom("users").select(["id"]).where("email", "=", customerEmail).executeTakeFirst();
          if (!user) continue;
          const site = await db.selectFrom("sites").select(["id"]).where("user_id", "=", user.id).limit(1).executeTakeFirst();
          if (!site) continue;

          const result = await processPolarOrder(db, order, site.id);
          if (result === "imported") synced++;
        }
        page++;
      } catch (err) {
        console.error("Polar cron sync error:", err);
        break;
      }
    }
    console.log(`Polar cron sync complete: ${synced} orders synced`);
  },
} satisfies ExportedHandler<Bindings>;

export { sql };
