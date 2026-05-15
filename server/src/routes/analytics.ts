import { Hono } from "hono";
import type { KlikapaDatabase, SiteDashboard, VisitorJourney, RecordingSummary, RecordingDetail } from "shared";
import type { Kysely } from "kysely";
import { sql, createDb } from "../db";
import { getDateRange } from "../utils";
import { getOverviewStats, getTimeseries, getTopPages, getReferrers, getDeviceBreakdown, getRevenueBySource, getRevenueByCountry, getRevenueTimeseries, getEntryPagesRevenue, getRevenueByPaymentMethod, getRevenueByPaymentProvider, getChannelBreakdown } from "../queries/analytics";
import { validateSite, parseFilters, toCsv, buildFunnelSteps, buildDepthSteps, processScrollEvents, buildHeatmapData } from "../lib/analytics-queries";
import type { FunnelStep } from "../lib/analytics-queries";

type Variables = { db: Kysely<KlikapaDatabase>; userId: string };
type AnalyticsEnv = { Variables: Variables; Bindings: { DB: D1Database } };

export const analyticsRoutes = new Hono<AnalyticsEnv>();

analyticsRoutes.get("/dashboard", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const siteId = c.req.query("site_id");
  const range = c.req.query("range") || "7d";
  const filtersParam = c.req.query("filters") || "";
  const filters = parseFilters(filtersParam);
  if (!siteId) return c.json({ error: "site_id required", success: false }, 400);
  const site = await validateSite(db, userId, siteId);
  if (!site) return c.json({ error: "Site not found", success: false }, 404);

  const { start, end } = getDateRange(range);
  const startIso = start.toISOString();
  const spanHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
  const isHourly = spanHours <= 48;

  const [stats, timeseries, topPages, sources, { devices, os, browsers }, recentSessions, profiles, revenueBySource, revenueByCountry, revenueTimeseries, entryPagesRevenue, revenueByMethod, revenueByProvider, channels] = await Promise.all([
    getOverviewStats(db, siteId, startIso),
    getTimeseries(db, siteId, startIso, isHourly),
    getTopPages(db, siteId, startIso, 10),
    getReferrers(db, siteId, startIso, 10),
    getDeviceBreakdown(db, siteId, startIso),
    db.selectFrom("sessions").select(["id", "visitor_id", "started_at", "country", "region", "city", "device_type", "browser", "os", "utm_source", "referrer", "page_count"])
      .where("site_id", "=", siteId).where("started_at", ">=", startIso).orderBy("started_at", "desc").limit(100).execute(),
    db.selectFrom("visitor_profiles").select(["id", "visitor_id", "name", "email", "phone", "first_seen", "last_seen", "country", "region", "city", "device_type", "browser", "os", "total_sessions", "total_pageviews", "total_revenue", "tags", "notes"])
      .where("site_id", "=", siteId).orderBy("last_seen", "desc").limit(50).execute(),
    getRevenueBySource(db, siteId, startIso),
    getRevenueByCountry(db, siteId, startIso),
    getRevenueTimeseries(db, siteId, startIso, isHourly),
    getEntryPagesRevenue(db, siteId, startIso),
    getRevenueByPaymentMethod(db, siteId, startIso),
    getRevenueByPaymentProvider(db, siteId, startIso),
    getChannelBreakdown(db, siteId, startIso),
  ]);

  const sessionIds = recentSessions.map((s) => s.id);
  const BATCH = 50;
  const allSessionEvents: { session_id: string; path: string; event_type: string; name: string | null; timestamp: string; revenue: number | null; props: string | null }[] = [];
  for (let i = 0; i < sessionIds.length; i += BATCH) {
    const batch = sessionIds.slice(i, i + BATCH);
    const rows = await db.selectFrom("events").select(["session_id", "path", "event_type", "name", "timestamp", "revenue", "props"])
      .where("session_id", "in", batch).where("site_id", "=", siteId).orderBy("timestamp", "asc").execute();
    allSessionEvents.push(...rows);
  }
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

  const dashboard: SiteDashboard = { stats, timeseries, topPages, sources, devices, os, browsers, journeys, revenueBySource, revenueByCountry, revenueTimeseries, entryPagesRevenue, revenueByMethod, revenueByProvider, channels };
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

  // Total unique visitors (funnel entry = all pageview visitors)
  const totalVisitors = await db.selectFrom("events").select(({ fn }) => [fn.count<number>("visitor_id").distinct().as("count")])
    .where("site_id", "=", siteId).where("timestamp", ">=", startIso).executeTakeFirst();

  // Get all scroll-related events with their page path
  const scrollEvents = await db.selectFrom("events").select([
    "visitor_id",
    "name",
    "props",
    "path",
  ]).where("site_id", "=", siteId)
    .where("name", "in", ["scroll", "scroll_section"])
    .where("timestamp", ">=", startIso).execute();

  // Per-page tracking: path -> section -> visitor set
  const { pageSectionVisitors, sectionVisitors, visitorDepths } = processScrollEvents(scrollEvents);

  const total = Number(totalVisitors?.count ?? 0);

  // Build global funnel
  let steps: FunnelStep[] = [];
  if (sectionVisitors.size > 0) {
    steps = buildFunnelSteps(sectionVisitors, total);
  } else {
    steps = buildDepthSteps(visitorDepths, total);
  }

  const convRate = steps.length >= 2 && total > 0 ? Math.round((steps[steps.length - 1]!.visitors / total) * 1000) / 10 : 0;

  // Build per-page funnels
  // Get pageview counts per page for totalVisitors per page
  const pageVisCounts = await db.selectFrom("events").select([
    "path",
    ({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors"),
  ]).where("site_id", "=", siteId).where("event_type", "=", "pageview")
    .where("timestamp", ">=", startIso)
    .groupBy("path").orderBy("visitors", "desc").limit(50).execute();

  const pageVisMap = new Map(pageVisCounts.map((r) => [r.path, Number(r.visitors)]));

  const pages = [...pageSectionVisitors.entries()]
    .map(([path, secMap]) => {
      const pageTotal = pageVisMap.get(path) ?? 0;
      const pageSteps = buildFunnelSteps(secMap, pageTotal);
      const pageConvRate = pageSteps.length >= 2 && pageTotal > 0 ? Math.round((pageSteps[pageSteps.length - 1]!.visitors / pageTotal) * 1000) / 10 : 0;
      return { path, steps: pageSteps, totalVisitors: pageTotal, conversionRate: pageConvRate };
    })
    .filter((p) => p.steps.length > 0)
    .sort((a, b) => b.totalVisitors - a.totalVisitors);

  return c.json({ data: { steps, totalVisitors: total, conversionRate: convRate, pages }, success: true });
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

  const heatmapData = buildHeatmapData(clickRows, scrollRows, Number(sessionCount?.cnt ?? 0));

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
    .select(["id", "session_id", "path", "duration", "viewport_width", "started_at", "events"])
    .where("site_id", "=", siteId).where("started_at", ">=", startIso)
    .orderBy("started_at", "desc").limit(50).execute();

  const recordings: RecordingSummary[] = rows.map((r) => {
    let eventCount = 0;
    try {
      const evts = JSON.parse((r as any).events || "[]");
      eventCount = Array.isArray(evts) ? evts.length : 0;
    } catch { /* ignore */ }
    return {
      id: r.id,
      session_id: r.session_id,
      path: r.path,
      duration: r.duration,
      viewport_width: r.viewport_width,
      started_at: r.started_at,
      event_count: eventCount,
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

// SSE endpoint for real-time visitor updates
analyticsRoutes.get("/stream", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const siteId = c.req.query("site_id");
  if (!siteId) return c.json({ error: "site_id required", success: false }, 400);

  const site = await validateSite(db, userId, siteId);
  if (!site) return c.json({ error: "Site not found", success: false }, 404);

  const d1 = c.env.DB;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;

      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch { closed = true; }
      };

      send("connected", { site_id: siteId, ts: Date.now() });

      let lastTs = new Date().toISOString();
      let iterations = 0;

      const poll = async () => {
        if (closed || iterations >= 10) {
          if (!closed) { send("close", { reason: "timeout" }); try { controller.close(); } catch {} closed = true; }
          return;
        }
        iterations++;

        try {
          const sdb = createDb(d1);
          const events = await sdb.selectFrom("events")
            .select(["id", "visitor_id", "event_type", "name", "path", "timestamp", "country", "city", "device_type", "browser"])
            .where("site_id", "=", siteId)
            .where("timestamp", ">", lastTs)
            .orderBy("timestamp", "asc")
            .limit(50)
            .execute();

          if (events.length > 0) {
            for (const ev of events) {
              send("visitor", ev);
            }
            lastTs = events[events.length - 1]!.timestamp;
          }

          // Also send live visitor count
          const liveCount = await sdb.selectFrom("events")
            .select(({ fn }) => fn.count<number>("visitor_id").distinct().as("count"))
            .where("site_id", "=", siteId)
            .where("timestamp", ">", new Date(Date.now() - 5 * 60_000).toISOString())
            .executeTakeFirst();
          send("stats", { live_visitors: liveCount?.count ?? 0 });
        } catch { /* ignore poll errors */ }

        if (!closed) setTimeout(poll, 2500);
      };

      setTimeout(poll, 1000);

      // Abort signal cleanup
      const req = c.req.raw;
      if (req.signal) {
        req.signal.addEventListener("abort", () => {
          closed = true;
          try { controller.close(); } catch {}
        });
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});

// Data export endpoint (CSV or JSON)
analyticsRoutes.get("/export", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const siteId = c.req.query("site_id");
  const format = c.req.query("format") || "csv";
  const type = c.req.query("type") || "events";
  const range = c.req.query("range") || "30d";

  if (!siteId) return c.json({ error: "site_id required", success: false }, 400);
  const site = await validateSite(db, userId, siteId);
  if (!site) return c.json({ error: "Site not found", success: false }, 404);

  const { start } = getDateRange(range);
  const startIso = start.toISOString();

  if (type === "visitors") {
    const rows = await db.selectFrom("visitor_profiles")
      .select(["visitor_id", "name", "email", "country", "region", "city", "device_type", "browser", "os", "total_sessions", "total_pageviews", "total_revenue", "first_seen", "last_seen"])
      .where("site_id", "=", siteId)
      .orderBy("last_seen", "desc")
      .limit(10000)
      .execute();

    if (format === "json") {
      return c.json({ data: rows, success: true });
    }
    const csv = toCsv(rows, ["visitor_id", "name", "email", "country", "region", "city", "device_type", "browser", "os", "total_sessions", "total_pageviews", "total_revenue", "first_seen", "last_seen"]);
    return new Response(csv, { headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="visitors-${siteId}-${range}.csv"` } });
  }

  if (type === "sessions") {
    const rows = await db.selectFrom("sessions")
      .select(["id", "visitor_id", "entry_path", "exit_path", "referrer", "utm_source", "utm_medium", "utm_campaign", "country", "city", "device_type", "browser", "page_count", "is_bounce", "started_at", "ended_at"])
      .where("site_id", "=", siteId)
      .where("started_at", ">=", startIso)
      .orderBy("started_at", "desc")
      .limit(10000)
      .execute();

    if (format === "json") {
      return c.json({ data: rows, success: true });
    }
    const csv = toCsv(rows, ["id", "visitor_id", "entry_path", "exit_path", "referrer", "utm_source", "utm_medium", "utm_campaign", "country", "city", "device_type", "browser", "page_count", "is_bounce", "started_at", "ended_at"]);
    return new Response(csv, { headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="sessions-${siteId}-${range}.csv"` } });
  }

  // Default: events
  const rows = await db.selectFrom("events")
    .select(["id", "visitor_id", "session_id", "event_type", "name", "path", "hostname", "referrer", "utm_source", "utm_medium", "utm_campaign", "country", "region", "city", "device_type", "browser", "os", "revenue", "timestamp"])
    .where("site_id", "=", siteId)
    .where("timestamp", ">=", startIso)
    .orderBy("timestamp", "desc")
    .limit(10000)
    .execute();

  if (format === "json") {
    return c.json({ data: rows, success: true });
  }
  const csv = toCsv(rows, ["id", "visitor_id", "session_id", "event_type", "name", "path", "hostname", "referrer", "utm_source", "utm_medium", "utm_campaign", "country", "region", "city", "device_type", "browser", "os", "revenue", "timestamp"]);
  return new Response(csv, { headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="events-${siteId}-${range}.csv"` } });
});
