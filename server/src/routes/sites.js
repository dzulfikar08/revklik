import { Hono } from "hono";
import { generateId, generateApiKey, hashToken } from "../utils";
import { sql } from "../db";
export const siteRoutes = new Hono();
siteRoutes.get("/", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const sites = await db.selectFrom("sites").select(["id", "name", "domain", "created_at"])
        .where("user_id", "=", userId).orderBy("created_at", "desc").execute();
    const startIso = new Date(Date.now() - 7 * 86400000).toISOString();
    const sitesWithStats = await Promise.all(sites.map(async (site) => {
        const [stats, sparkRows] = await Promise.all([
            db.selectFrom("events").select([
                ({ fn }) => fn.count("id").as("pageviews"),
                ({ fn }) => fn.count("visitor_id").distinct().as("visitors"),
                ({ fn }) => fn.sum("revenue").as("revenue"),
            ]).where("site_id", "=", site.id).where("event_type", "=", "pageview").where("timestamp", ">=", startIso)
                .executeTakeFirst(),
            db.selectFrom("events").select([({ fn }) => fn.count("id").as("count")])
                .where("site_id", "=", site.id).where("event_type", "=", "pageview").where("timestamp", ">=", startIso)
                .groupBy(sql `date(${sql.ref("timestamp")})`).orderBy("timestamp", "asc").execute(),
        ]);
        return {
            ...site,
            pageviews: Number(stats?.pageviews ?? 0),
            visitors: Number(stats?.visitors ?? 0),
            revenue: Number(stats?.revenue ?? 0),
            sparkline: sparkRows.map((r) => Number(r.count)),
        };
    }));
    return c.json({ data: sitesWithStats, success: true });
});
siteRoutes.post("/", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const { name, domain } = await c.req.json();
    if (!name || !domain)
        return c.json({ error: "Name and domain required", success: false }, 400);
    const siteId = generateId();
    await db.insertInto("sites").values({
        id: siteId, user_id: userId, name, domain, created_at: new Date().toISOString(),
    }).execute();
    return c.json({ data: { id: siteId, name, domain, created_at: new Date().toISOString() }, success: true }, 201);
});
siteRoutes.delete("/:siteId", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const siteId = c.req.param("siteId");
    const site = await db.selectFrom("sites").select(["id"]).where("id", "=", siteId).where("user_id", "=", userId).executeTakeFirst();
    if (!site)
        return c.json({ error: "Site not found", success: false }, 404);
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
    if (!site)
        return c.json({ error: "Site not found", success: false }, 404);
    const origin = new URL(c.req.url).origin;
    const snippet = `<script src="${origin}/klikapa.js"></script>
<script>
  window.klikapa_site_id = "${siteId}";
  window.klikapa_endpoint = "${origin}/api/track";
</script>`;
    return c.json({ data: { siteId, snippet }, success: true });
});
