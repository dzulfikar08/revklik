import { Hono } from "hono";
import type { KlikapaDatabase, SiteDashboard, StatsResponse, TimeSeriesPoint, TopPage, SourceEntry, VisitorJourney, VisitorProfile } from "shared";
import type { Kysely } from "kysely";
import { sql } from "../db";
import { getDateRange } from "../utils";

type Variables = { db: Kysely<KlikapaDatabase>; userId: string };

export const analyticsRoutes = new Hono<{ Variables: Variables }>();

function validateSite(db: Kysely<KlikapaDatabase>, userId: string, siteId: string) {
  return db.selectFrom("sites").select(["id"]).where("id", "=", siteId).where("user_id", "=", userId).executeTakeFirst();
}

analyticsRoutes.get("/dashboard", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const siteId = c.req.query("site_id");
  const range = c.req.query("range") || "7d";
  if (!siteId) return c.json({ error: "site_id required", success: false }, 400);
  const site = await validateSite(db, userId, siteId);
  if (!site) return c.json({ error: "Site not found", success: false }, 404);

  const { start } = getDateRange(range);
  const startIso = start.toISOString();

  const [pv, vi, se, bo, rev, conv, tsRows, pageRows, sourceRows, recentSessions, profiles] = await Promise.all([
    db.selectFrom("events").select(({ fn }) => [fn.count<number>("id").as("count")])
      .where("site_id", "=", siteId).where("event_type", "=", "pageview").where("timestamp", ">=", startIso).executeTakeFirst(),
    db.selectFrom("events").select(({ fn }) => [fn.count<number>("visitor_id").distinct().as("count")])
      .where("site_id", "=", siteId).where("timestamp", ">=", startIso).executeTakeFirst(),
    db.selectFrom("sessions").select(({ fn }) => [fn.count<number>("id").as("count")])
      .where("site_id", "=", siteId).where("started_at", ">=", startIso).executeTakeFirst(),
    db.selectFrom("sessions").select(({ fn }) => [fn.avg<number>("is_bounce").as("avg")])
      .where("site_id", "=", siteId).where("started_at", ">=", startIso).executeTakeFirst(),
    db.selectFrom("events").select(({ fn }) => [fn.sum<number>("revenue").as("total")])
      .where("site_id", "=", siteId).where("revenue", ">", 0).where("timestamp", ">=", startIso).executeTakeFirst(),
    db.selectFrom("events").select(({ fn }) => [fn.count<number>("id").as("count")])
      .where("site_id", "=", siteId).where("event_type", "=", "conversion").where("timestamp", ">=", startIso).executeTakeFirst(),
    db.selectFrom("events").select([
      ({ fn }) => fn.count<number>("id").as("pageviews"),
      ({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors"),
      "timestamp",
    ]).where("site_id", "=", siteId).where("event_type", "=", "pageview").where("timestamp", ">=", startIso)
      .groupBy(sql`date(${sql.ref("timestamp")})`).orderBy("timestamp", "asc").execute(),
    db.selectFrom("events").select(["path", ({ fn }) => fn.count<number>("id").as("pageviews"), ({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors")])
      .where("site_id", "=", siteId).where("event_type", "=", "pageview").where("timestamp", ">=", startIso)
      .groupBy("path").orderBy("pageviews", "desc").limit(10).execute(),
    db.selectFrom("events").select([
      ({ fn }) => fn.coalesce("utm_source", sql.lit("direct")).as("source"),
      ({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors"),
    ]).where("site_id", "=", siteId).where("timestamp", ">=", startIso)
      .groupBy(({ fn }) => fn.coalesce("utm_source", sql.lit("direct"))).orderBy("visitors", "desc").limit(10).execute(),
    db.selectFrom("sessions").select(["id", "visitor_id", "started_at", "country", "device_type", "browser", "os", "utm_source", "referrer", "page_count"])
      .where("site_id", "=", siteId).where("started_at", ">=", startIso).orderBy("started_at", "desc").limit(30).execute(),
    db.selectFrom("visitor_profiles").select(["id", "visitor_id", "name", "email", "phone", "first_seen", "last_seen", "country", "city", "device_type", "browser", "os", "total_sessions", "total_pageviews", "total_revenue", "tags", "notes"])
      .where("site_id", "=", siteId).orderBy("last_seen", "desc").limit(50).execute(),
  ]);

  const stats: StatsResponse = {
    pageviews: Number(pv?.count ?? 0), visitors: Number(vi?.count ?? 0),
    sessions: Number(se?.count ?? 0), bounceRate: Math.round(Number(bo?.avg ?? 0) * 100),
    avgDuration: 0, revenue: Number(rev?.total ?? 0), conversions: Number(conv?.count ?? 0),
  };

  const timeseries: TimeSeriesPoint[] = tsRows.map((r) => {
    const ts = String(r.timestamp ?? new Date().toISOString());
    return { date: ts.split("T")[0] ?? ts, pageviews: Number(r.pageviews), visitors: Number(r.visitors) };
  });

  const topPages: TopPage[] = pageRows.map((r) => ({ path: r.path, pageviews: Number(r.pageviews), visitors: Number(r.visitors) }));

  const totalSrc = sourceRows.reduce((s, r) => s + Number(r.visitors), 0);
  const sources: SourceEntry[] = sourceRows.map((r) => ({
    source: String(r.source), visitors: Number(r.visitors),
    percentage: totalSrc > 0 ? Math.round((Number(r.visitors) / totalSrc) * 100) : 0,
  }));

  const journeys: VisitorJourney[] = [];
  for (const sess of recentSessions) {
    const events = await db.selectFrom("events").select(["path", "event_type", "name", "timestamp", "revenue"])
      .where("session_id", "=", sess.id).where("site_id", "=", siteId).orderBy("timestamp", "asc").execute();
    const profile = profiles.find((p) => p.visitor_id === sess.visitor_id);
    journeys.push({
      session_id: sess.id, visitor_id: sess.visitor_id,
      visitor_name: profile?.name ?? null, visitor_email: profile?.email ?? null,
      country: sess.country ?? profile?.country ?? null, city: profile?.city ?? null,
      device_type: sess.device_type ?? null, browser: sess.browser ?? null, os: sess.os ?? null,
      utm_source: sess.utm_source ?? null, referrer: sess.referrer ?? null,
      started_at: sess.started_at,
      steps: events.map((e) => ({ path: e.path, event_type: e.event_type, name: e.name, timestamp: e.timestamp, revenue: e.revenue })),
      total_revenue: events.reduce((s, e) => s + Number(e.revenue ?? 0), 0),
      is_identified: !!(profile?.name || profile?.email),
    });
  }

  const dashboard: SiteDashboard = { stats, timeseries, topPages, sources, journeys };
  return c.json({ data: dashboard, success: true });
});

analyticsRoutes.get("/sparkline", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const siteId = c.req.query("site_id");
  if (!siteId) return c.json({ error: "site_id required", success: false }, 400);
  const site = await validateSite(db, userId, siteId);
  if (!site) return c.json({ error: "Site not found", success: false }, 404);

  const rows = await db.selectFrom("events").select([
    ({ fn }) => fn.count<number>("id").as("count"),
    "timestamp",
  ]).where("site_id", "=", siteId).where("event_type", "=", "pageview")
    .where("timestamp", ">=", new Date(Date.now() - 7 * 86400000).toISOString())
    .groupBy(sql`date(${sql.ref("timestamp")})`).orderBy("timestamp", "asc").execute();

  return c.json({ data: rows.map((r) => Number(r.count)), success: true });
});

analyticsRoutes.get("/visitors", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const siteId = c.req.query("site_id");
  if (!siteId) return c.json({ error: "site_id required", success: false }, 400);
  const site = await validateSite(db, userId, siteId);
  if (!site) return c.json({ error: "Site not found", success: false }, 404);

  const visitors = await db.selectFrom("visitor_profiles")
    .select(["id", "visitor_id", "name", "email", "phone", "first_seen", "last_seen", "country", "city", "device_type", "browser", "os", "total_sessions", "total_pageviews", "total_revenue", "tags", "notes"])
    .where("site_id", "=", siteId).orderBy("last_seen", "desc").limit(100).execute();

  return c.json({ data: visitors, success: true });
});

analyticsRoutes.patch("/visitors/:visitorId", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const profileId = c.req.param("visitorId");
  const body = await c.req.json();

  const profile = await db.selectFrom("visitor_profiles").select(["id", "site_id"])
    .where("id", "=", profileId).executeTakeFirst();
  if (!profile) return c.json({ error: "Not found", success: false }, 404);

  const site = await validateSite(db, userId, profile.site_id);
  if (!site) return c.json({ error: "Not found", success: false }, 404);

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.email !== undefined) updates.email = body.email;
  if (body.phone !== undefined) updates.phone = body.phone;
  if (body.tags !== undefined) updates.tags = body.tags;
  if (body.notes !== undefined) updates.notes = body.notes;

  if (Object.keys(updates).length > 0) {
    await db.updateTable("visitor_profiles").set(updates).where("id", "=", profileId).execute();
  }

  return c.json({ success: true });
});
