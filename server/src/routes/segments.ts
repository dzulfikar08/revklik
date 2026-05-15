import { Hono } from "hono";
import type { KlikapaDatabase } from "shared";
import type { Kysely } from "kysely";
import { generateId } from "../utils";

type Variables = { db: Kysely<KlikapaDatabase>; userId: string };

export const segmentRoutes = new Hono<{ Variables: Variables }>();

function validateSite(db: Kysely<KlikapaDatabase>, userId: string, siteId: string) {
  return db.selectFrom("sites").select(["id"])
    .where("id", "=", siteId)
    .where((eb) => eb.or([
      eb("user_id", "=", userId),
      eb.exists(eb.selectFrom("team_members").select("id").where("site_id", "=", siteId).where("user_id", "=", userId).where("accepted_at", "is not", null)),
    ]))
    .executeTakeFirst();
}

segmentRoutes.get("/", async (c) => {
  const db = c.get("db");
  const siteId = c.req.query("site_id");
  if (!siteId) return c.json({ error: "site_id required", success: false }, 400);

  const segments = await db.selectFrom("segments").selectAll()
    .where("site_id", "=", siteId).orderBy("created_at", "desc").execute();
  return c.json({ data: segments, success: true });
});

segmentRoutes.post("/", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const { site_id, name, filters } = await c.req.json();
  if (!site_id || !name || !filters) return c.json({ error: "site_id, name, and filters required", success: false }, 400);

  const site = await validateSite(db, userId, site_id);
  if (!site) return c.json({ error: "Site not found", success: false }, 404);

  const id = generateId();
  await db.insertInto("segments").values({
    id, site_id, name, filters: JSON.stringify(filters), created_at: new Date().toISOString(),
  }).execute();
  return c.json({ data: { id, site_id, name, filters, created_at: new Date().toISOString() }, success: true }, 201);
});

segmentRoutes.delete("/:segmentId", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const segmentId = c.req.param("segmentId");

  const segment = await db.selectFrom("segments").select(["id", "site_id"]).where("id", "=", segmentId).executeTakeFirst();
  if (!segment) return c.json({ error: "Segment not found", success: false }, 404);

  const site = await validateSite(db, userId, segment.site_id);
  if (!site) return c.json({ error: "Not found", success: false }, 404);

  await db.deleteFrom("segments").where("id", "=", segmentId).execute();
  return c.json({ success: true });
});
