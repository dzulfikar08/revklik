import { Hono } from "hono";
import type { KlikapaDatabase, TrackEventPayload, IdentifyPayload } from "shared";
import type { Kysely } from "kysely";
import { generateId } from "../utils";

type Variables = { db: Kysely<KlikapaDatabase> };

export const trackRoutes = new Hono<{ Variables: Variables }>();

trackRoutes.post("/track", async (c) => {
  const db = c.get("db");
  const payload: TrackEventPayload = await c.req.json();
  const siteId = payload.s;
  if (!siteId) return c.json({ error: "site_id required", success: false }, 400);

  const site = await db.selectFrom("sites").select(["id"]).where("id", "=", siteId).executeTakeFirst();
  if (!site) return c.json({ error: "Invalid site_id", success: false }, 400);

  const now = new Date().toISOString();
  const eventType = payload.t === "p" ? "pageview" : payload.t === "c" ? "conversion" : "custom";

  await db.insertInto("events").values({
    id: generateId(), site_id: siteId, session_id: payload.sid, visitor_id: payload.vid,
    timestamp: now, event_type: eventType, name: payload.n ?? null, path: payload.p,
    hostname: payload.h ?? null, referrer: payload.r ?? null,
    utm_source: payload.us ?? null, utm_medium: payload.um ?? null, utm_campaign: payload.uc ?? null,
    utm_term: payload.ut ?? null, utm_content: payload.uco ?? null,
    revenue: payload.rv ?? null, props: payload.pr ? JSON.stringify(payload.pr) : null,
    country: null, city: null, device_type: null, browser: null, os: null,
  }).execute();

  await db.insertInto("sessions").values({
    id: payload.sid, site_id: siteId, visitor_id: payload.vid,
    started_at: now, entry_path: payload.p, exit_path: payload.p,
    referrer: payload.r ?? null, utm_source: payload.us ?? null,
    utm_medium: payload.um ?? null, utm_campaign: payload.uc ?? null,
    page_count: 1, is_bounce: 1,
  }).onConflict((oc) => oc.column("id").doUpdateSet({
    exit_path: payload.p, ended_at: now, page_count: 999, is_bounce: 0,
  })).execute();

  const pvInc = eventType === "pageview" ? 1 : 0;
  const rvInc = payload.rv ?? 0;
  await db.insertInto("visitor_profiles").values({
    id: generateId(), site_id: siteId, visitor_id: payload.vid,
    first_seen: now, last_seen: now,
    total_sessions: 1, total_pageviews: pvInc, total_revenue: rvInc,
  }).onConflict((oc) => oc.columns(["site_id", "visitor_id"]).doUpdateSet({
    last_seen: now,
    total_pageviews: 999,
    total_revenue: rvInc > 0 ? 999 : undefined,
  })).execute();

  return c.json({ success: true }, { status: 202 });
});

trackRoutes.post("/identify", async (c) => {
  const db = c.get("db");
  const payload: IdentifyPayload = await c.req.json();
  const siteId = payload.s;
  if (!siteId || !payload.vid) return c.json({ error: "site_id and visitor_id required", success: false }, 400);

  await db.insertInto("visitor_profiles").values({
    id: generateId(), site_id: siteId, visitor_id: payload.vid,
    name: payload.name ?? null, email: payload.email ?? null, phone: payload.phone ?? null,
    avatar: payload.avatar ?? null, first_seen: new Date().toISOString(),
    last_seen: new Date().toISOString(), total_sessions: 0, total_pageviews: 0, total_revenue: 0,
  }).onConflict((oc) => oc.columns(["site_id", "visitor_id"]).doUpdateSet({
    name: payload.name ?? undefined,
    email: payload.email ?? undefined,
    phone: payload.phone ?? undefined,
    avatar: payload.avatar ?? undefined,
    last_seen: new Date().toISOString(),
  })).execute();

  return c.json({ success: true }, { status: 202 });
});
