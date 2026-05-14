import { Hono } from "hono";
import type { KlikapaDatabase, SiteDashboard, StatsResponse, TimeSeriesPoint, TopPage, SourceEntry, VisitorJourney, VisitorProfile, HeatmapData, RecordingSummary, RecordingDetail } from "shared";
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
    db.selectFrom("sessions").select(["id", "visitor_id", "started_at", "country", "region", "city", "device_type", "browser", "os", "utm_source", "referrer", "page_count"])
      .where("site_id", "=", siteId).where("started_at", ">=", startIso).orderBy("started_at", "desc").limit(30).execute(),
    db.selectFrom("visitor_profiles").select(["id", "visitor_id", "name", "email", "phone", "first_seen", "last_seen", "country", "region", "city", "device_type", "browser", "os", "total_sessions", "total_pageviews", "total_revenue", "tags", "notes"])
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

  const sessionIds = recentSessions.map((s) => s.id);
  const allSessionEvents = sessionIds.length > 0 ? await db.selectFrom("events").select(["session_id", "path", "event_type", "name", "timestamp", "revenue", "props"])
    .where("session_id", "in", sessionIds).where("site_id", "=", siteId).orderBy("timestamp", "asc").execute() : [];
  const eventsBySession = new Map<string, typeof allSessionEvents>();
  for (const e of allSessionEvents) {
    if (!eventsBySession.has(e.session_id)) eventsBySession.set(e.session_id, []);
    eventsBySession.get(e.session_id)!.push(e);
  }

  const journeys: VisitorJourney[] = [];
  for (const sess of recentSessions) {
    const events = eventsBySession.get(sess.id) ?? [];
    const profile = profiles.find((p) => p.visitor_id === sess.visitor_id);
    journeys.push({
      session_id: sess.id, visitor_id: sess.visitor_id,
      visitor_name: profile?.name ?? null, visitor_email: profile?.email ?? null,
      country: sess.country ?? profile?.country ?? null,
      region: sess.region ?? profile?.region ?? null,
      city: sess.city ?? profile?.city ?? null,
      device_type: sess.device_type ?? null, browser: sess.browser ?? null, os: sess.os ?? null,
      utm_source: sess.utm_source ?? null, referrer: sess.referrer ?? null,
      started_at: sess.started_at,
      steps: events.map((e) => ({ path: e.path, event_type: e.event_type, name: e.name, timestamp: e.timestamp, revenue: e.revenue, props: e.props })),
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

analyticsRoutes.get("/funnel", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const siteId = c.req.query("site_id");
  const range = c.req.query("range") || "7d";
  if (!siteId) return c.json({ error: "site_id required", success: false }, 400);
  const site = await validateSite(db, userId, siteId);
  if (!site) return c.json({ error: "Site not found", success: false }, 404);

  const { start } = getDateRange(range);
  const startIso = start.toISOString();

  // Get total unique visitors for the period (funnel entry)
  const totalVisitors = await db.selectFrom("events").select(({ fn }) => [fn.count<number>("visitor_id").distinct().as("count")])
    .where("site_id", "=", siteId).where("timestamp", ">=", startIso).executeTakeFirst();

  // Get scroll_section events: unique visitors per section
  const sectionRows = await db.selectFrom("events").select([
    ({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors"),
    "props",
  ]).where("site_id", "=", siteId).where("name", "=", "scroll_section").where("timestamp", ">=", startIso)
    .groupBy("props").execute();

  // Also get scroll depth milestones (25/50/75/90)
  const depthRows = await db.selectFrom("events").select([
    ({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors"),
    "props",
  ]).where("site_id", "=", siteId).where("name", "=", "scroll").where("timestamp", ">=", startIso)
    .groupBy("props").execute();

  // Parse section visitors from props JSON
  const sectionVisitors: Record<string, number> = {};
  for (const row of sectionRows) {
    try {
      const p = JSON.parse(row.props ?? "{}");
      if (p.section) sectionVisitors[p.section] = Number(row.visitors);
    } catch { /* skip */ }
  }

  const depthVisitors: Record<string, number> = {};
  for (const row of depthRows) {
    try {
      const p = JSON.parse(row.props ?? "{}");
      if (p.depth) depthVisitors[String(p.depth)] = Number(row.visitors);
    } catch { /* skip */ }
  }

  // Ordered sections (page order)
  const sections = ["hero", "features", "how-it-works", "code-example", "pricing", "comparison", "blog", "cta"];
  const total = Number(totalVisitors?.count ?? 0);

  const steps = sections
    .filter((s) => sectionVisitors[s] !== undefined)
    .map((section, i, arr) => {
      const visitors = sectionVisitors[section]!;
      const prevVisitors = i === 0 ? total : (arr[i - 1] ? sectionVisitors[arr[i - 1]!] ?? total : total);
      return {
        section,
        visitors,
        percentage: total > 0 ? Math.round((visitors / total) * 100) : 0,
        dropoff: i > 0 && prevVisitors > 0 ? Math.round(((prevVisitors - visitors) / prevVisitors) * 100) : 0,
      };
    });

  // If no section data, build from depth milestones
  const depths = [25, 50, 75, 90]
    .filter((d) => depthVisitors[String(d)] !== undefined)
    .map((d, i, arr) => {
      const key = String(d);
      const visitors = depthVisitors[key]!;
      const prevKey = arr[i - 1] !== undefined ? String(arr[i - 1]) : null;
      const prevVisitors = i === 0 ? total : (prevKey ? depthVisitors[prevKey] ?? total : total);
      return {
        section: `${d}%`,
        visitors,
        percentage: total > 0 ? Math.round((visitors / total) * 100) : 0,
        dropoff: i > 0 && prevVisitors > 0 ? Math.round(((prevVisitors - visitors) / prevVisitors) * 100) : 0,
      };
    });

  const stepsOut = steps.length > 0 ? steps : depths;
  const convRate = stepsOut.length >= 2 && total > 0 ? Math.round((stepsOut[stepsOut.length - 1]!.visitors / total) * 1000) / 10 : 0;

  return c.json({ data: { steps: stepsOut, totalVisitors: total, conversionRate: convRate }, success: true });
});

analyticsRoutes.get("/visitors", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const siteId = c.req.query("site_id");
  if (!siteId) return c.json({ error: "site_id required", success: false }, 400);
  const site = await validateSite(db, userId, siteId);
  if (!site) return c.json({ error: "Site not found", success: false }, 404);

  const visitors = await db.selectFrom("visitor_profiles")
    .select(["id", "visitor_id", "name", "email", "phone", "first_seen", "last_seen", "country", "region", "city", "device_type", "browser", "os", "total_sessions", "total_pageviews", "total_revenue", "tags", "notes"])
    .where("site_id", "=", siteId).orderBy("last_seen", "desc").limit(100).execute();

  return c.json({ data: visitors, success: true });
});

analyticsRoutes.patch("/visitors/:visitorId", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const profileId = c.req.param("visitorId");
  const body = await c.req.json();

  const profile = await db.selectFrom("visitor_profiles").select(["id", "site_id"])
    .where("visitor_id", "=", profileId).executeTakeFirst();
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

analyticsRoutes.get("/geo", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const siteId = c.req.query("site_id");
  const range = c.req.query("range") || "7d";
  if (!siteId) return c.json({ error: "site_id required", success: false }, 400);
  const site = await validateSite(db, userId, siteId);
  if (!site) return c.json({ error: "Site not found", success: false }, 404);

  const { start } = getDateRange(range);
  const startIso = start.toISOString();

  const rows = await db.selectFrom("events")
    .select(["country", "region", "city", ({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors")])
    .where("site_id", "=", siteId)
    .where("timestamp", ">=", startIso)
    .groupBy(["country", "region", "city"])
    .orderBy("visitors", "desc")
    .limit(50)
    .execute();

  return c.json({ data: rows, success: true });
});

// Heatmap analytics
analyticsRoutes.get("/heatmap", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const siteId = c.req.query("site_id");
  const path = c.req.query("path") || "/";
  const range = c.req.query("range") || "7d";
  if (!siteId) return c.json({ error: "site_id required", success: false }, 400);
  const site = await validateSite(db, userId, siteId);
  if (!site) return c.json({ error: "Site not found", success: false }, 404);

  const { start } = getDateRange(range);
  const startIso = start.toISOString();

  const [clickRows, scrollRows, sessionCount] = await Promise.all([
    db.selectFrom("heatmap_clicks").select(["x", "y", "element_selector", "element_text", "visitor_id"])
      .where("site_id", "=", siteId).where("path", "=", path).where("timestamp", ">=", startIso)
      .limit(5000)
      .execute(),
    db.selectFrom("heatmap_scrolls").select(["max_scroll", "visitor_id"])
      .where("site_id", "=", siteId).where("path", "=", path).where("timestamp", ">=", startIso)
      .limit(5000)
      .execute(),
    db.selectFrom("heatmap_clicks").select(({ fn }) => [fn.count<string>("visitor_id").distinct().as("cnt")])
      .where("site_id", "=", siteId).where("path", "=", path).where("timestamp", ">=", startIso)
      .executeTakeFirst(),
  ]);

  // Build 50x50 click grid (2% buckets)
  const grid: number[][] = Array.from({ length: 50 }, () => Array(50).fill(0));
  const elemMap: Record<string, { selector: string; clicks: number; label: string }> = {};

  for (const row of clickRows) {
    const bx = Math.min(49, Math.max(0, Math.floor(Number(row.x) / 2)));
    const by = Math.min(49, Math.max(0, Math.floor(Number(row.y) / 2)));
    grid[by]![bx]!++;
    if (row.element_selector) {
      const key = row.element_selector;
      if (!elemMap[key]) elemMap[key] = { selector: key, clicks: 0, label: row.element_text || key };
      elemMap[key]!.clicks++;
    }
  }

  const topElements = Object.values(elemMap).sort((a, b) => b.clicks - a.clicks).slice(0, 20);

  // Build scroll depth distribution
  const depthBuckets: Record<number, { depth: number; visitors: Set<string> }> = {};
  for (let d = 0; d <= 100; d += 10) depthBuckets[d] = { depth: d, visitors: new Set<string>() };
  for (const row of scrollRows) {
    const d = Math.min(100, Math.max(0, Math.round(Number(row.max_scroll) / 10) * 10));
    depthBuckets[d]!.visitors.add(row.visitor_id);
  }
  const scrollDepths = Object.values(depthBuckets).map((b) => ({ depth: b.depth, visitors: b.visitors.size }));

  const heatmapData: HeatmapData = {
    clickGrid: grid,
    scrollDepths,
    totalSessions: Number(sessionCount?.cnt ?? 0),
    totalClicks: clickRows.length,
    topElements,
  };

  return c.json({ data: heatmapData, success: true });
});

// List session recordings
analyticsRoutes.get("/recordings", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const siteId = c.req.query("site_id");
  const range = c.req.query("range") || "7d";
  if (!siteId) return c.json({ error: "site_id required", success: false }, 400);
  const site = await validateSite(db, userId, siteId);
  if (!site) return c.json({ error: "Site not found", success: false }, 404);

  const { start } = getDateRange(range);
  const startIso = start.toISOString();

  const rows = await db.selectFrom("session_recordings")
    .select(["id", "session_id", "path", "duration", "viewport_width", "started_at"])
    .where("site_id", "=", siteId).where("started_at", ">=", startIso)
    .orderBy("started_at", "desc").limit(50).execute();

  const recordings: RecordingSummary[] = rows.map((r) => {
    return {
      id: r.id,
      session_id: r.session_id,
      path: r.path,
      duration: r.duration,
      viewport_width: r.viewport_width,
      started_at: r.started_at,
      event_count: 0,
      has_revenue: false,
    };
  });

  return c.json({ data: recordings, success: true });
});

// Get single recording
analyticsRoutes.get("/recordings/:id", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const recordingId = c.req.param("id");

  const row = await db.selectFrom("session_recordings")
    .selectAll()
    .where("id", "=", recordingId)
    .executeTakeFirst();
  if (!row) return c.json({ error: "Recording not found", success: false }, 404);

  const site = await validateSite(db, userId, row.site_id);
  if (!site) return c.json({ error: "Not found", success: false }, 404);

  let events: Array<{ t: number; type: "mutation" | "interaction" | "scroll" | "resize"; d: unknown }> = [];
  try { events = JSON.parse(row.events); } catch { events = []; }

  // Map compact event types to full names
  const typeMap: Record<string, "mutation" | "interaction" | "scroll" | "resize"> = { m: "mutation", c: "interaction", s: "scroll", r: "resize" };
  const mappedEvents = events.map((e) => ({
    t: e.t,
    type: typeMap[e.type as string] ?? "interaction",
    d: e.d,
  }));

  let eventCount = mappedEvents.length;

  const detail: RecordingDetail = {
    id: row.id,
    session_id: row.session_id,
    path: row.path,
    duration: row.duration,
    viewport_width: row.viewport_width,
    started_at: row.started_at,
    event_count: eventCount,
    has_revenue: false,
    events: mappedEvents,
    viewport_height: row.viewport_height,
  };

  return c.json({ data: detail, success: true });
});