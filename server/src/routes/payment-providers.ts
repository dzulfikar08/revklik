import { Hono } from "hono";
import type { KlikapaDatabase } from "shared";
import type { Kysely } from "kysely";
import { generateId } from "../utils";

type Variables = { db: Kysely<KlikapaDatabase>; userId: string };
export const paymentProviderRoutes = new Hono<{ Variables: Variables }>();

const VALID_PROVIDERS = ["midtrans", "xendit", "doku", "nicepay"];

function maskConfig(config: Record<string, string>): Record<string, string> {
  const masked: Record<string, string> = {};
  const sensitive = ["server_key", "client_key", "secret_key", "client_secret", "webhook_secret"];
  for (const [k, v] of Object.entries(config)) {
    masked[k] = sensitive.includes(k) ? (v.length <= 4 ? "****" : "****" + v.slice(-4)) : v;
  }
  return masked;
}

function validateSite(db: Kysely<KlikapaDatabase>, userId: string, siteId: string) {
  return db.selectFrom("sites").select(["id"]).where("id", "=", siteId)
    .where((eb) => eb.or([
      eb("user_id", "=", userId),
      eb.exists(eb.selectFrom("team_members").select(["id"]).where("site_id", "=", siteId).where("user_id", "=", userId).where("accepted_at", "is not", null)),
    ])).executeTakeFirst();
}

paymentProviderRoutes.get("/", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const siteId = c.req.query("site_id");
  if (!siteId) return c.json({ error: "site_id required" }, 400);
  const site = await validateSite(db, userId, siteId);
  if (!site) return c.json({ error: "Site not found" }, 404);
  const rows = await db.selectFrom("payment_providers").selectAll().where("site_id", "=", siteId).orderBy("created_at", "desc").execute();
  return c.json({ data: rows.map(r => ({ ...r, config: maskConfig(JSON.parse((r.config as string) || "{}")), enabled: Number(r.enabled) === 1 })), success: true });
});

paymentProviderRoutes.post("/", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const { site_id, provider, config } = await c.req.json();
  if (!site_id || !provider || !config) return c.json({ error: "site_id, provider, config required" }, 400);
  if (!VALID_PROVIDERS.includes(provider)) return c.json({ error: `Invalid provider: ${provider}` }, 400);
  const site = await validateSite(db, userId, site_id);
  if (!site) return c.json({ error: "Site not found" }, 404);
  const existing = await db.selectFrom("payment_providers").select(["id"]).where("site_id", "=", site_id).where("provider", "=", provider).executeTakeFirst();
  if (existing) return c.json({ error: `${provider} already configured` }, 409);
  const id = generateId();
  await db.insertInto("payment_providers").values({ id, site_id, provider, config: JSON.stringify(config), enabled: 1, created_at: new Date().toISOString() }).execute();
  return c.json({ data: { id, provider, enabled: true }, success: true }, 201);
});

paymentProviderRoutes.delete("/:provider", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const provider = c.req.param("provider");
  const site_id = c.req.query("site_id");
  if (!site_id) return c.json({ error: "site_id required" }, 400);
  const site = await validateSite(db, userId, site_id);
  if (!site) return c.json({ error: "Site not found" }, 404);
  await db.deleteFrom("payment_providers").where("site_id", "=", site_id).where("provider", "=", provider).execute();
  return c.json({ success: true });
});
