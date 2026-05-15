import { Hono } from "hono";
import type { KlikapaDatabase, CreateSitePayload, Site, SiteWithStats } from "shared";
import type { Kysely } from "kysely";
import { generateId, generateApiKey, hashToken } from "../utils";
import { sql } from "../db";

type Variables = { db: Kysely<KlikapaDatabase>; userId: string };

export const siteRoutes = new Hono<{ Variables: Variables }>();

siteRoutes.get("/", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");

  const sites = await db.selectFrom("sites").select(["id", "name", "domain", "created_at"])
    .where("user_id", "=", userId).orderBy("created_at", "desc").execute();

  const startIso = new Date(Date.now() - 7 * 86400000).toISOString();

  const sitesWithStats: SiteWithStats[] = await Promise.all(
    sites.map(async (site) => {
      const [stats, sparkRows] = await Promise.all([
        db.selectFrom("events").select([
          ({ fn }) => fn.count<number>("id").as("pageviews"),
          ({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors"),
          ({ fn }) => fn.sum<number>("revenue").as("revenue"),
        ]).where("site_id", "=", site.id).where("event_type", "=", "pageview").where("timestamp", ">=", startIso)
          .executeTakeFirst(),
        db.selectFrom("events").select([({ fn }) => fn.count<number>("id").as("count")])
          .where("site_id", "=", site.id).where("event_type", "=", "pageview").where("timestamp", ">=", startIso)
          .groupBy(sql`date(${sql.ref("timestamp")})`).orderBy("timestamp", "asc").execute(),
      ]);

      return {
        ...site,
        pageviews: Number(stats?.pageviews ?? 0),
        visitors: Number(stats?.visitors ?? 0),
        revenue: Number(stats?.revenue ?? 0),
        sparkline: sparkRows.map((r) => Number(r.count)),
      };
    }),
  );

  return c.json({ data: sitesWithStats, success: true });
});

siteRoutes.post("/", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const { name, domain } = await c.req.json<CreateSitePayload>();
  if (!name || !domain) return c.json({ error: "Name and domain required", success: false }, 400);

  const siteId = generateId();
  await db.insertInto("sites").values({
    id: siteId, user_id: userId, name, domain, created_at: new Date().toISOString(),
    share_token: null, public_dashboard: 0,
  }).execute();

  return c.json({ data: { id: siteId, name, domain, created_at: new Date().toISOString() } as Site, success: true }, 201);
});

siteRoutes.delete("/:siteId", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const siteId = c.req.param("siteId");
  const site = await db.selectFrom("sites").select(["id"]).where("id", "=", siteId).where("user_id", "=", userId).executeTakeFirst();
  if (!site) return c.json({ error: "Site not found", success: false }, 404);

  await db.deleteFrom("events").where("site_id", "=", siteId).execute();
  await db.deleteFrom("sessions").where("site_id", "=", siteId).execute();
  await db.deleteFrom("visitor_profiles").where("site_id", "=", siteId).execute();
  await db.deleteFrom("sites").where("id", "=", siteId).execute();
  return c.json({ success: true });
});

siteRoutes.get("/:siteId/snippet", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const siteId = c.req.param("siteId");
  const site = await db.selectFrom("sites").select(["id", "name", "domain"]).where("id", "=", siteId).where("user_id", "=", userId).executeTakeFirst();
  if (!site) return c.json({ error: "Site not found", success: false }, 404);

  const origin = new URL(c.req.url).origin;
  const snippet = `<script src="${origin}/klikapa.js"></script>
<script>
  window.klikapa_site_id = "${siteId}";
  window.klikapa_endpoint = "${origin}/api/track";
</script>`;
  return c.json({ data: { siteId, snippet }, success: true });
});
