import { Hono } from "hono";
import type { PublicApiEnv } from "../../middleware/public-auth";
import type { KlikapaDatabase } from "shared";
import type { Kysely } from "kysely";
import { requireScope } from "../../middleware/scope-validator";

export const v1SitesRoutes = new Hono<PublicApiEnv>();

function validateSite(db: Kysely<KlikapaDatabase>, userId: string, siteId: string) {
  return db.selectFrom("sites").select(["id"]).where("id", "=", siteId)
    .where((eb) => eb.or([
      eb("user_id", "=", userId),
      eb.exists(eb.selectFrom("team_members").select("id").where("site_id", "=", siteId).where("user_id", "=", userId).where("accepted_at", "is not", null)),
    ])).executeTakeFirst();
}

// GET / — List sites
v1SitesRoutes.get("/", requireScope("sites:read"), async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const tokenSiteId = c.get("tokenSiteId");

  // For site tokens, only return the bound site
  if (tokenSiteId) {
    const site = await validateSite(db, userId, tokenSiteId);
    if (!site) {
      return c.json({ error: "Site not found", success: false }, 404);
    }
    const sites = await db.selectFrom("sites")
      .select(["id", "name", "domain", "created_at"])
      .where("id", "=", tokenSiteId)
      .execute();
    return c.json({ data: sites, success: true });
  }

  // For account tokens, return all user sites (owned + team)
  const sites = await db.selectFrom("sites")
    .select(["id", "name", "domain", "created_at"])
    .where((eb) => eb.or([
      eb("user_id", "=", userId),
      eb.exists(eb.selectFrom("team_members").select("id").whereRef("site_id", "=", "sites.id").where("user_id", "=", userId).where("accepted_at", "is not", null)),
    ]))
    .orderBy("created_at", "desc")
    .execute();

  return c.json({ data: sites, success: true });
});

// GET /:siteId — Get single site
v1SitesRoutes.get("/:siteId", requireScope("sites:read"), async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const tokenSiteId = c.get("tokenSiteId");
  const siteId = c.req.param("siteId");

  // For site tokens, reject if siteId doesn't match bound site
  if (tokenSiteId && tokenSiteId !== siteId) {
    return c.json({ error: "Token not valid for this site", success: false }, 403);
  }

  const site = await validateSite(db, userId, siteId);
  if (!site) {
    return c.json({ error: "Site not found", success: false }, 404);
  }

  const siteData = await db.selectFrom("sites")
    .select(["id", "name", "domain", "created_at"])
    .where("id", "=", siteId)
    .executeTakeFirst();

  return c.json({ data: siteData, success: true });
});
