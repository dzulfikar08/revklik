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

app.onError((err, c) => {
  console.error("Server error:", err);
  return c.json({ error: err.message, success: false }, 500);
});

export default app;
export { sql };
