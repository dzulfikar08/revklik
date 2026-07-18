import { Hono } from "hono";
import type { Kysely } from "kysely";
import type {
	IdentifyPayload,
	KlikapaDatabase,
	TrackEventPayload,
} from "shared";
import { sql } from "../db";
import {
	enforceSiteQuota,
	incrementCachedCount,
} from "../lib/subscription-cache";
import {
	countryFromTimezone,
	fingerprintFromRequest,
	generateId,
} from "../utils";

type Variables = { db: Kysely<KlikapaDatabase> };

export const trackRoutes = new Hono<{ Variables: Variables }>();

// In-memory rate limiter (per-isolate, resets on Worker recycle)
const rlMap = new Map<string, { count: number; resetAt: number }>();
let lastCleanup = Date.now();

function rateLimit(key: string, limit: number, windowMs: number): boolean {
	const now = Date.now();
	if (now - lastCleanup > 120_000) {
		for (const [k, v] of rlMap) {
			if (now > v.resetAt) rlMap.delete(k);
		}
		lastCleanup = now;
	}
	const entry = rlMap.get(key);
	if (!entry || now > entry.resetAt) {
		rlMap.set(key, { count: 1, resetAt: now + windowMs });
		return true;
	}
	entry.count++;
	return entry.count <= limit;
}

trackRoutes.post("/track", async (c) => {
	const ip = c.req.header("cf-connecting-ip") || "unknown";
	if (!rateLimit(ip, 120, 60_000)) {
		return c.json({ error: "Rate limit exceeded", success: false }, 429);
	}

	const db = c.get("db");
	const raw = await c.req.json();

	// Cloudflare geo — prefer cf object for country/region/city, fall back to header
	const cf = (c.req.raw as Request & { cf?: Record<string, unknown> }).cf;
	let cfCountry: string | null =
		(cf?.country as string) ?? c.req.header("cf-ipcountry") ?? null;
	const cfRegion = (cf?.region as string) ?? null;
	const cfCity = (cf?.city as string) ?? null;

	// Support batch (array) or single event
	const payloads: TrackEventPayload[] = Array.isArray(raw) ? raw : [raw];
	if (payloads.length === 0)
		return c.json({ error: "empty payload", success: false }, 400);

	const first = payloads[0];
	if (!first) return c.json({ error: "empty payload", success: false }, 400);
	const siteId = first.s;
	if (!siteId)
		return c.json({ error: "site_id required", success: false }, 400);

	const site = await db
		.selectFrom("sites")
		.select(["id"])
		.where("id", "=", siteId)
		.executeTakeFirst();
	if (!site) return c.json({ error: "Invalid site_id", success: false }, 400);

	// Subscription + quota enforcement
	const enforcement = await enforceSiteQuota(db, siteId);
	if (!enforcement.allowed) {
		return c.json(
			{
				success: true,
				quota: {
					limit: enforcement.eventsLimit,
					used: enforcement.eventsUsed,
					plan: enforcement.plan,
					period_end: enforcement.periodEnd,
				},
				reason: enforcement.reason,
			},
			{ status: 202 },
		);
	}

	// Fall back to client timezone when Cloudflare geo is unavailable
	if (!cfCountry) {
		cfCountry = countryFromTimezone(first.tz);
	}

	const deviceType = first.dv ?? null;
	const browser = first.br ?? null;
	const os = first.os ?? null;

	// Cookieless attribution: compute fingerprint from request headers
	const fingerprint = await fingerprintFromRequest(c.req.raw, first.sr);

	// Resolve visitor ID via fingerprint — prefer existing visitor for journey continuity
	let resolvedVid = first.vid;
	if (fingerprint) {
		const existing = await db
			.selectFrom("visitor_profiles")
			.select(["visitor_id"])
			.where("site_id", "=", siteId)
			.where("fingerprint", "=", fingerprint)
			.orderBy("first_seen", "asc")
			.limit(1)
			.executeTakeFirst();
		if (existing && existing.visitor_id !== first.vid) {
			resolvedVid = existing.visitor_id;
		}
	}

	const seenSids = new Set<string>();
	for (const payload of payloads) {
		if (payload.s !== siteId) continue;
		const isNewSession = !seenSids.has(payload.sid);
		seenSids.add(payload.sid);
		const sessionInc = isNewSession ? 1 : 0;

		const ts = payload.ts
			? new Date(payload.ts).toISOString()
			: new Date().toISOString();
		const eventType =
			payload.t === "p"
				? "pageview"
				: payload.t === "c"
					? "conversion"
					: "custom";
		const vid = fingerprint ? resolvedVid : payload.vid;

		await db
			.insertInto("events")
			.values({
				id: generateId(),
				site_id: payload.s,
				session_id: payload.sid,
				visitor_id: vid,
				timestamp: ts,
				event_type: eventType,
				name: payload.n ?? null,
				path: payload.p,
				hostname: payload.h ?? null,
				referrer: payload.r ?? null,
				utm_source: payload.us ?? null,
				utm_medium: payload.um ?? null,
				utm_campaign: payload.uc ?? null,
				utm_term: payload.ut ?? null,
				utm_content: payload.uco ?? null,
				revenue: payload.rv ?? null,
				props: payload.pr ? JSON.stringify(payload.pr) : null,
				country: cfCountry,
				region: cfRegion,
				city: cfCity,
				device_type: deviceType,
				browser,
				os,
				fingerprint,
			})
			.execute();

		const pvInc = eventType === "pageview" ? 1 : 0;
		const rvInc = payload.rv ?? 0;

		await db
			.insertInto("sessions")
			.values({
				id: payload.sid,
				site_id: payload.s,
				visitor_id: vid,
				started_at: ts,
				entry_path: payload.p,
				exit_path: payload.p,
				referrer: payload.r ?? null,
				utm_source: payload.us ?? null,
				utm_medium: payload.um ?? null,
				utm_campaign: payload.uc ?? null,
				country: cfCountry,
				region: cfRegion,
				city: cfCity,
				device_type: deviceType,
				browser,
				os,
				page_count: 1,
				is_bounce: 1,
				fingerprint,
			})
			.onConflict((oc) =>
				oc.column("id").doUpdateSet({
					exit_path: payload.p,
					ended_at: ts,
					page_count: sql`page_count + 1`,
					is_bounce: 0,
				}),
			)
			.execute();

		await db
			.insertInto("visitor_profiles")
			.values({
				id: generateId(),
				site_id: payload.s,
				visitor_id: vid,
				first_seen: ts,
				last_seen: ts,
				country: cfCountry,
				region: cfRegion,
				city: cfCity,
				device_type: deviceType,
				browser,
				os,
				total_sessions: 1,
				total_pageviews: pvInc,
				total_revenue: rvInc,
				fingerprint,
			})
			.onConflict((oc) =>
				oc.columns(["site_id", "visitor_id"]).doUpdateSet({
					last_seen: ts,
					fingerprint: fingerprint ?? undefined,
					country: cfCountry ?? undefined,
					region: cfRegion ?? undefined,
					city: cfCity ?? undefined,
					device_type: deviceType ?? undefined,
					browser: browser ?? undefined,
					os: os ?? undefined,
					total_pageviews: sql`total_pageviews + ${pvInc}`,
					total_sessions:
						sessionInc > 0 ? sql`total_sessions + ${sessionInc}` : undefined,
					total_revenue: rvInc > 0 ? sql`total_revenue + ${rvInc}` : undefined,
				}),
			)
			.execute();
	}

	incrementCachedCount(siteId, payloads.length);

	return c.json(
		{ success: true, vid: resolvedVid !== first.vid ? resolvedVid : undefined },
		{ status: 202 },
	);
});

trackRoutes.post("/identify", async (c) => {
	const db = c.get("db");
	const payload: IdentifyPayload = await c.req.json();
	const siteId = payload.s;
	if (!siteId || !payload.vid)
		return c.json(
			{ error: "site_id and visitor_id required", success: false },
			400,
		);

	const enforcement = await enforceSiteQuota(db, siteId);
	if (!enforcement.allowed) {
		return c.json(
			{ success: true, reason: enforcement.reason },
			{ status: 202 },
		);
	}

	const fingerprint = await fingerprintFromRequest(c.req.raw);

	await db
		.insertInto("visitor_profiles")
		.values({
			id: generateId(),
			site_id: siteId,
			visitor_id: payload.vid,
			name: payload.name ?? null,
			email: payload.email ?? null,
			phone: payload.phone ?? null,
			avatar: payload.avatar ?? null,
			first_seen: new Date().toISOString(),
			last_seen: new Date().toISOString(),
			total_sessions: 0,
			total_pageviews: 0,
			total_revenue: 0,
			fingerprint,
		})
		.onConflict((oc) =>
			oc.columns(["site_id", "visitor_id"]).doUpdateSet({
				name: payload.name ?? undefined,
				email: payload.email ?? undefined,
				phone: payload.phone ?? undefined,
				avatar: payload.avatar ?? undefined,
				last_seen: new Date().toISOString(),
				fingerprint: fingerprint ?? undefined,
			}),
		)
		.execute();

	return c.json({ success: true }, { status: 202 });
});

// Heatmap tracking endpoint
trackRoutes.post("/track/heatmap", async (c) => {
	const ip = c.req.header("cf-connecting-ip") || "unknown";
	if (!rateLimit(`hm:${ip}`, 60, 60_000)) {
		return c.json({ error: "Rate limit exceeded", success: false }, 429);
	}

	const db = c.get("db");
	const body = await c.req.json();
	const siteId = body.s;
	if (!siteId || !body.sid || !body.vid)
		return c.json({ error: "s, sid, vid required", success: false }, 400);

	const site = await db
		.selectFrom("sites")
		.select(["id"])
		.where("id", "=", siteId)
		.executeTakeFirst();
	if (!site) return c.json({ error: "Invalid site_id", success: false }, 400);

	const enforcement = await enforceSiteQuota(db, siteId, true);
	if (!enforcement.allowed) {
		return c.json(
			{ success: true, reason: enforcement.reason },
			{ status: 202 },
		);
	}

	const path = body.p || "/";
	const ts = new Date().toISOString();

	if (body.t === "click") {
		await db
			.insertInto("heatmap_clicks")
			.values({
				id: generateId(),
				site_id: siteId,
				session_id: body.sid,
				visitor_id: body.vid,
				path,
				x: Number(body.x) || 0,
				y: Number(body.y) || 0,
				element_selector: body.sel ?? null,
				element_text: body.txt ?? null,
				viewport_width: body.vw ?? null,
				timestamp: ts,
			})
			.execute();
	} else if (body.t === "scroll") {
		await db
			.insertInto("heatmap_scrolls")
			.values({
				id: generateId(),
				site_id: siteId,
				session_id: body.sid,
				visitor_id: body.vid,
				path,
				max_scroll: Number(body.ms) || 0,
				viewport_height: body.vh ?? null,
				doc_height: body.dh ?? null,
				timestamp: ts,
			})
			.execute();
	} else {
		return c.json(
			{ error: "Invalid type, expected click or scroll", success: false },
			400,
		);
	}

	return c.json({ success: true }, { status: 202 });
});

// Session recording endpoint
trackRoutes.post("/track/recording", async (c) => {
	const ip = c.req.header("cf-connecting-ip") || "unknown";
	if (!rateLimit(`rec:${ip}`, 30, 60_000)) {
		return c.json({ error: "Rate limit exceeded", success: false }, 429);
	}

	const db = c.get("db");
	const body = await c.req.json();
	const siteId = body.s;
	if (!siteId || !body.sid || !body.vid)
		return c.json({ error: "s, sid, vid required", success: false }, 400);
	if (!Array.isArray(body.chunk) || body.chunk.length === 0)
		return c.json({ error: "chunk required", success: false }, 400);
	if (body.chunk.length > 200)
		return c.json(
			{ error: "chunk too large (max 200 events)", success: false },
			400,
		);

	const site = await db
		.selectFrom("sites")
		.select(["id"])
		.where("id", "=", siteId)
		.executeTakeFirst();
	if (!site) return c.json({ error: "Invalid site_id", success: false }, 400);

	const enforcement = await enforceSiteQuota(db, siteId, true);
	if (!enforcement.allowed) {
		return c.json(
			{ success: true, reason: enforcement.reason },
			{ status: 202 },
		);
	}

	const path = body.p || "/";
	const ts = new Date().toISOString();
	const chunkEvents = JSON.stringify(body.chunk);
	const lastEvent = body.chunk[body.chunk.length - 1];
	const duration = lastEvent?.t ?? 0;

	// Atomic upsert using insert-or-ignore + update to avoid race conditions
	const existing = await db
		.selectFrom("session_recordings")
		.select(["id"])
		.where("session_id", "=", body.sid)
		.executeTakeFirst();

	if (existing) {
		// Append chunk to existing events atomically using SQL string concat
		const chunkPrefix = body.chunk.length > 0 ? "," : "";
		const appendStr = chunkPrefix + chunkEvents.slice(1, -1); // Remove outer [] from chunk
		await db
			.updateTable("session_recordings")
			.set({
				events: sql`substr(events, 1, length(events) - 1) || ${appendStr} || ']'`,
				duration: sql`max(duration, ${duration})`,
				ended_at: ts,
			})
			.where("id", "=", existing.id)
			.execute();
	} else {
		await db
			.insertInto("session_recordings")
			.values({
				id: generateId(),
				site_id: siteId,
				session_id: body.sid,
				visitor_id: body.vid,
				path,
				events: chunkEvents,
				duration,
				viewport_width: body.vw ?? null,
				viewport_height: body.vh ?? null,
				started_at: ts,
				ended_at: ts,
			})
			.execute();
	}

	return c.json({ success: true }, { status: 202 });
});

// Server-side Payment API — track payments from any provider (DataFast-style)
trackRoutes.post("/track/payment", async (c) => {
	const ip = c.req.header("cf-connecting-ip") || "unknown";
	if (!rateLimit(`pay:${ip}`, 30, 60_000)) {
		return c.json({ error: "Rate limit exceeded", success: false }, 429);
	}

	const db = c.get("db");
	const body = await c.req.json();
	const { s: siteId, vid, amount, transaction_id, name } = body;

	if (!siteId || amount == null || !transaction_id) {
		return c.json(
			{
				error: "site_id (s), amount, and transaction_id required",
				success: false,
			},
			400,
		);
	}

	const site = await db
		.selectFrom("sites")
		.select(["id"])
		.where("id", "=", siteId)
		.executeTakeFirst();
	if (!site) return c.json({ error: "Invalid site_id", success: false }, 400);

	const enforcement = await enforceSiteQuota(db, siteId);
	if (!enforcement.allowed) {
		return c.json(
			{
				success: true,
				quota: {
					limit: enforcement.eventsLimit,
					used: enforcement.eventsUsed,
					plan: enforcement.plan,
				},
				reason: enforcement.reason,
			},
			{ status: 202 },
		);
	}

	// Idempotency: check for existing event with this transaction_id
	const existing = await db
		.selectFrom("events")
		.select(["id"])
		.where("site_id", "=", siteId)
		.where("event_type", "=", "conversion")
		.where("props", "like", `%"transaction_id":"${transaction_id}"%`)
		.executeTakeFirst();
	if (existing)
		return c.json({ success: true, event_id: existing.id, duplicate: true });

	const cf = (c.req.raw as Request & { cf?: Record<string, unknown> }).cf;
	const cfCountry =
		(cf?.country as string) ?? c.req.header("cf-ipcountry") ?? null;
	const cfRegion = (cf?.region as string) ?? null;
	const cfCity = (cf?.city as string) ?? null;

	let visitorId = vid;
	let utmSource: string | null = null;
	let utmMedium: string | null = null;
	let utmCampaign: string | null = null;
	let referrer: string | null = null;

	// If visitor_id provided, look up their last event to inherit attribution
	if (vid) {
		const lastEvent = await db
			.selectFrom("events")
			.select(["utm_source", "utm_medium", "utm_campaign", "referrer"])
			.where("site_id", "=", siteId)
			.where("visitor_id", "=", vid)
			.orderBy("timestamp", "desc")
			.limit(1)
			.executeTakeFirst();
		if (lastEvent) {
			utmSource = lastEvent.utm_source;
			utmMedium = lastEvent.utm_medium;
			utmCampaign = lastEvent.utm_campaign;
			referrer = lastEvent.referrer;
		}
	} else {
		visitorId = `pay_${transaction_id.replace(/[^a-zA-Z0-9]/g, "_")}`;
	}

	const sessionId = body.sid || generateId();
	const ts = body.timestamp
		? new Date(body.timestamp).toISOString()
		: new Date().toISOString();
	const eventId = generateId();

	await db
		.insertInto("events")
		.values({
			id: eventId,
			site_id: siteId,
			session_id: sessionId,
			visitor_id: visitorId,
			timestamp: ts,
			event_type: "conversion",
			name: name || "payment",
			path: "/payment",
			hostname: null,
			referrer,
			utm_source: utmSource,
			utm_medium: utmMedium,
			utm_campaign: utmCampaign,
			utm_term: null,
			utm_content: null,
			revenue: Number(amount),
			props: JSON.stringify({ transaction_id, ...(body.props || {}) }),
			country: cfCountry,
			region: cfRegion,
			city: cfCity,
			device_type: null,
			browser: null,
			os: null,
			fingerprint: null,
		})
		.execute();

	await db
		.insertInto("visitor_profiles")
		.values({
			id: generateId(),
			site_id: siteId,
			visitor_id: visitorId,
			first_seen: ts,
			last_seen: ts,
			country: cfCountry,
			region: cfRegion,
			city: cfCity,
			device_type: null,
			browser: null,
			os: null,
			total_sessions: 0,
			total_pageviews: 0,
			total_revenue: Number(amount),
			fingerprint: null,
		})
		.onConflict((oc) =>
			oc.columns(["site_id", "visitor_id"]).doUpdateSet({
				last_seen: ts,
				total_revenue: sql`total_revenue + ${Number(amount)}`,
			}),
		)
		.execute();

	return c.json({ success: true, event_id: eventId, visitor_id: visitorId });
});
