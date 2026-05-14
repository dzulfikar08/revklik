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
import { billingRoutes } from "./routes/billing";
import { teamRoutes } from "./routes/team";
import { docsRoutes } from "./routes/docs";
import { hashPassword, generateId, generateApiKey, hashToken } from "./utils";

type Bindings = { DB: D1Database };
type Variables = { db: Kysely<KlikapaDatabase>; userId: string };
type Env = { Bindings: Bindings; Variables: Variables };

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

app.post("/auth/register", async (c) => {
  const db = c.get("db");
  if (!db) return c.json({ error: "DB unavailable", success: false }, 503);
  const { name, email, password } = await c.req.json();
  if (!name || !email || !password) return c.json({ error: "All fields required", success: false }, 400);

  const existing = await db.selectFrom("users").select(["id"]).where("email", "=", email).executeTakeFirst();
  if (existing) return c.json({ error: "Email taken", success: false }, 409);

  const userId = generateId();
  await db.insertInto("users").values({ id: userId, email, password_hash: await hashPassword(password), name, created_at: new Date().toISOString() }).execute();
  const { key, prefix } = generateApiKey();
  await db.insertInto("api_keys").values({ id: generateId(), user_id: userId, key_hash: await hashToken(key), key_prefix: prefix, name: "default", created_at: new Date().toISOString() }).execute();
  return c.json({ data: { user: { id: userId, name, email }, token: key }, success: true }, 201);
});

app.post("/auth/login", async (c) => {
  const db = c.get("db");
  if (!db) return c.json({ error: "DB unavailable", success: false }, 503);
  const { email, password } = await c.req.json();
  const user = await db.selectFrom("users").select(["id", "name", "email", "password_hash"]).where("email", "=", email).executeTakeFirst();
  if (!user || (await hashPassword(password)) !== user.password_hash) return c.json({ error: "Invalid credentials", success: false }, 401);

  const { key } = generateApiKey();
  await db.insertInto("api_keys").values({ id: generateId(), user_id: user.id, key_hash: await hashToken(key), key_prefix: key.slice(0, 7), name: "session", created_at: new Date().toISOString() }).execute();
  return c.json({ data: { user: { id: user.id, name: user.name, email: user.email }, token: key }, success: true });
});

app.use("/sites/*", authMiddleware);
app.route("/sites", siteRoutes);

app.use("/analytics/*", authMiddleware);
app.route("/analytics", analyticsRoutes);

app.use("/ai-insights/*", authMiddleware);
app.route("/ai-insights", aiInsightsRoutes);

app.use("/integrations/*", authMiddleware);
app.route("/integrations", integrationRoutes);

app.route("/webhooks", webhookRoutes);

// Billing webhook (no auth — Polar calls this)
app.post("/billing/webhook", async (c) => {
  const d1 = c.env.DB;
  if (!d1) return c.json({ error: "DB unavailable" }, 503);
  const db = createDb(d1);
  const body = await c.req.text();
  const signature = c.req.header("X-Polar-Signature") || "";
  const secret = (c.env as any).POLAR_WEBHOOK_SECRET || "";
  if (secret && signature) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
    const computed = btoa(String.fromCharCode(...new Uint8Array(sig)));
    const sigClean = signature.replace(/^sha256=/, "");
    if (computed.length !== sigClean.length) return c.json({ error: "Invalid signature" }, 401);
    let r = 0;
    for (let i = 0; i < computed.length; i++) r |= computed.charCodeAt(i) ^ sigClean.charCodeAt(i);
    if (r !== 0) return c.json({ error: "Invalid signature" }, 401);
  }
  try {
    const event = JSON.parse(body);
    const userId = event.metadata?.user_id || event.data?.metadata?.user_id;
    const plan = event.metadata?.plan || event.data?.metadata?.plan;
    if (!userId) return c.json({ error: "Missing user_id" }, 400);
    if (event.type === "subscription.created" || event.type === "subscription.updated") {
      const s = event.data;
      await db.insertInto("subscriptions").values({
        id: generateId(), user_id: userId, plan: plan || "starter",
        status: s?.status || "active",
        current_period_start: s?.current_period_start || new Date().toISOString(),
        current_period_end: s?.current_period_end || new Date(Date.now() + 30 * 86400000).toISOString(),
        cancel_at_period_end: 0, polar_subscription_id: s?.id || null, polar_customer_id: s?.customer_id || null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).onConflict((oc) => oc.column("user_id").doUpdateSet({
        plan: plan || "starter", status: s?.status || "active",
        current_period_end: s?.current_period_end || undefined,
        polar_subscription_id: s?.id || undefined, updated_at: new Date().toISOString(),
      })).execute();
    } else if (event.type === "subscription.canceled") {
      await db.updateTable("subscriptions").set({ cancel_at_period_end: 1, status: "canceled", updated_at: new Date().toISOString() }).where("user_id", "=", userId).execute();
    }
    return c.json({ success: true });
  } catch (err: any) { return c.json({ error: err.message }, 500); }
});

app.use("/billing/*", authMiddleware);
app.route("/billing", billingRoutes);

app.use("/team/*", authMiddleware);
app.route("/team", teamRoutes);

app.onError((err, c) => {
  console.error("Server error:", err);
  return c.json({ error: err.message, success: false }, 500);
});

export default app;
export { sql };
