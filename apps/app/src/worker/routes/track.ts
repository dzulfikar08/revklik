import { Hono } from "hono";
import type { Compilable, Kysely } from "kysely";
import type { IdentifyPayload, KlikapaDatabase, TrackEventPayload } from "@revklik/shared";
import { sql } from "../db";
import { classifyIngestSignals } from "../lib/bot-detection";
import {
	eventCurrency,
	resolveEventTimestamp,
	SESSION_GAP_CAP_SECONDS,
	sanitizeRevenue,
} from "../lib/ingest";
import { clientSaleFields, type ClientSaleFields } from "../lib/revenue-hygiene";
import { accountUsageIncrement } from "../lib/account-usage";
import { executeBatch } from "../lib/d1-batch";
import { isSelfHosted } from "../lib/entitlement";
import { enforceSiteQuota, incrementCachedUsage } from "../lib/subscription-cache";
import { resolveVisitorId } from "../lib/visitor-identity";
import {
	countryFromTimezone,
	classifyCrawler,
	classifyDatacenterVisitor,
	fingerprintFromRequest,
	generateId,
	isBotUserAgent,
} from "../utils";

type Variables = { db: Kysely<KlikapaDatabase> };

export const trackRoutes = new Hono<{
	Variables: Variables;
	Bindings: { DB: D1Database; SELF_HOSTED?: string; FX_USD_IDR?: string };
}>();

/** Events accepted per /track request; larger batches are rejected with 413. */
export const MAX_TRACK_BATCH = 50;

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

// Per-site excluded-fingerprint cache (self-traffic blocklist).
// Workers isolate memory; cache is best-effort with a short TTL.
const excludedCache = new Map<string, { fps: Set<string>; exp: number }>();
const EXCLUDED_TTL_MS = 60_000;

async function isExcludedFingerprint(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	fingerprint: string,
): Promise<boolean> {
	if (!fingerprint) return false;
	const now = Date.now();
	const cached = excludedCache.get(siteId);
	if (cached && now < cached.exp) {
		return cached.fps.has(fingerprint);
	}
	const row = await db
		.selectFrom("sites")
		.select(["excluded_fingerprints"])
		.where("id", "=", siteId)
		.executeTakeFirst();
	const fps = new Set<string>();
	if (row?.excluded_fingerprints) {
		try {
			const v = JSON.parse(row.excluded_fingerprints);
			if (Array.isArray(v)) for (const x of v) if (typeof x === "string") fps.add(x);
		} catch {
			/* ignore malformed */
		}
	}
	excludedCache.set(siteId, { fps, exp: now + EXCLUDED_TTL_MS });
	return fps.has(fingerprint);
}

/** Invalidate the excluded-fingerprint cache (call when a site's blocklist changes). */
export function invalidateExcludedCache(siteId?: string): void {
	if (siteId) excludedCache.delete(siteId);
	else excludedCache.clear();
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
	let cfCountry: string | null = (cf?.country as string) ?? c.req.header("cf-ipcountry") ?? null;
	const cfRegion = (cf?.region as string) ?? null;
	const cfCity = (cf?.city as string) ?? null;
	const cfAsOrg = (cf?.asOrganization as string | undefined) ?? null;
	// Present only on Cloudflare Bot Management plans.
	const cfBotManagement = cf?.botManagement as
		| { score?: number; verifiedBot?: boolean }
		| undefined;

	// Support batch (array) or single event
	const payloads: TrackEventPayload[] = Array.isArray(raw) ? raw : [raw];
	if (payloads.length === 0) return c.json({ error: "empty payload", success: false }, 400);
	if (payloads.length > MAX_TRACK_BATCH) {
		return c.json(
			{ error: `batch too large (max ${MAX_TRACK_BATCH} events)`, success: false },
			413,
		);
	}

	// Known crawler/bot user-agents never enter human analytics. AI crawlers
	// (and every other bot, bucketed as "other") are recorded fire-and-forget
	// into crawler_hits for the Crawlers analytics panel. The response is
	// always a silent success so the tracker never retries. UA-based only;
	// datacenter IPs that spoof a real browser UA are not caught here.
	const botUa = c.req.header("user-agent");
	if (isBotUserAgent(botUa) || cfBotManagement?.verifiedBot === true) {
		const hit = classifyCrawler(botUa);
		const botSiteId = payloads[0]?.s;
		if (hit && botSiteId) {
			const botPath = payloads[0]?.p ?? null;
			const botTs = new Date().toISOString();
			c.executionCtx.waitUntil(
				(async () => {
					const site = await db
						.selectFrom("sites")
						.select(["id"])
						.where("id", "=", botSiteId)
						.executeTakeFirst();
					if (!site) return;
					await db
						.insertInto("crawler_hits")
						.values({
							id: generateId(),
							site_id: botSiteId,
							bot: hit.bot,
							category: hit.category,
							path: botPath,
							user_agent: botUa ?? null,
							country: cfCountry,
							timestamp: botTs,
						})
						.execute();
				})().catch(() => {}),
			);
		}
		return c.json({ success: true, excluded: true }, { status: 202 });
	}

	// Same treatment for browser-shaped automation from hosting networks: the UA
	// branch above cannot see it, and these requests inflate every human metric
	// (a datacenter "visitor" scrolls a whole page in under a second and never
	// converts). Recorded in crawler_hits so the traffic stays auditable.
	const dcOrg = classifyDatacenterVisitor(cfAsOrg);
	if (dcOrg) {
		const dcSiteId = payloads[0]?.s;
		const dcPath = payloads[0]?.p ?? null;
		if (dcSiteId) {
			c.executionCtx.waitUntil(
				(async () => {
					const site = await db
						.selectFrom("sites")
						.select(["id"])
						.where("id", "=", dcSiteId)
						.executeTakeFirst();
					if (!site) return;
					await db
						.insertInto("crawler_hits")
						.values({
							id: generateId(),
							site_id: dcSiteId,
							bot: `datacenter:${dcOrg}`,
							category: "other",
							path: dcPath,
							user_agent: botUa ?? null,
							country: cfCountry,
							timestamp: new Date().toISOString(),
						})
						.execute();
				})().catch(() => {}),
			);
		}
		return c.json({ success: true, excluded: true }, { status: 202 });
	}

	const first = payloads[0];
	if (!first) return c.json({ error: "empty payload", success: false }, 400);
	const siteId = first.s;
	if (!siteId) return c.json({ error: "site_id required", success: false }, 400);

	const site = await db
		.selectFrom("sites")
		.select(["id", "revenue_currency"])
		.where("id", "=", siteId)
		.executeTakeFirst();
	if (!site) return c.json({ error: "Invalid site_id", success: false }, 400);

	// Subscription + quota enforcement
	const enforcement = await enforceSiteQuota(db, siteId, false, isSelfHosted(c.env));
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

	// Bots that pass the UA and network checks above are still stored, but
	// flagged: analytics reads skip them, and a later rule change can re-judge them.
	const botReason = classifyIngestSignals({
		city: cfCity,
		asOrganization: cfAsOrg,
		botScore: cfBotManagement?.score,
		webdriver: payloads.some((p) => p.wd === 1),
		probeFields: payloads.flatMap((p) => [p.r, p.p, p.us, p.um, p.uc, p.ut, p.uco]),
	});
	const isBot = botReason ? 1 : 0;

	const deviceType = first.dv ?? null;
	// WhatsApp in-app browsers ship a Chrome/Safari UA plus a `WhatsApp/x.y`
	// token; the client-side parse only sees Chrome/Safari. Server UA wins so
	// query-time attribution can classify these clicks as whatsapp
	// (see sourceSql in queries/analytics.ts).
	let browser = first.br ?? null;
	if (botUa && /WhatsApp\/\d/.test(botUa)) browser = "WhatsApp";
	const os = first.os ?? null;

	// Request fingerprint: the self-traffic blocklist key, and the identity of a
	// client that sends no visitor id. It never overrides a client-sent id, so
	// visitors sharing an IP, browser and screen (carrier NAT, offices) stay apart.
	const fingerprint = await fingerprintFromRequest(c.req.raw, first.sr);

	// Self-traffic exclusion: drop events from blocklisted fingerprints.
	if (fingerprint && (await isExcludedFingerprint(db, siteId, fingerprint))) {
		return c.json({ success: true, excluded: true }, { status: 202 });
	}

	const writes: Compilable[] = [];
	// A batch never overshoots the plan: events past the remaining allowance are dropped.
	const allowance = Math.max(0, enforcement.eventsLimit - enforcement.eventsUsed);
	let ingested = 0;
	for (const payload of payloads) {
		if (payload.s !== siteId) continue;
		const vid = resolveVisitorId(payload.vid, fingerprint);
		if (!vid) continue;
		if (ingested >= allowance) break;
		ingested++;

		const ts = resolveEventTimestamp(payload.ts);
		const revenue = sanitizeRevenue(payload.rv);
		const eventType = payload.t === "p" ? "pageview" : payload.t === "c" ? "conversion" : "custom";
		const currency =
			revenue === null ? null : eventCurrency(payload.cur, payload.pr, site.revenue_currency);
		// Money the browser reports gets its rail, fee-rule net and test/duplicate verdict now.
		let sale: ClientSaleFields | null = null;
		if (revenue !== null && revenue > 0) {
			sale = await clientSaleFields(db, {
				siteId,
				visitorId: vid,
				path: payload.p,
				revenue,
				currency: currency ?? "USD",
				ts,
				props: payload.pr,
				guardDoubleFire: true,
				env: c.env,
			});
		}

		writes.push(
			db.insertInto("events").values({
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
				revenue,
				currency,
				...(sale
					? {
							rail: sale.rail,
							product: sale.product,
							payment_provider: sale.payment_provider,
							net_revenue: sale.net_revenue,
							net_source: sale.net_source,
							excluded_reason: sale.excluded_reason,
						}
					: {}),
				props:
					payload.pr || sale?.duplicate_of
						? JSON.stringify({
								...payload.pr,
								...(sale?.duplicate_of ? { duplicate_of: sale.duplicate_of } : {}),
							})
						: null,
				country: cfCountry,
				region: cfRegion,
				city: cfCity,
				device_type: deviceType,
				browser,
				os,
				fingerprint,
				is_bot: isBot,
			}),
		);

		const pvInc = eventType === "pageview" ? 1 : 0;
		const rvInc = sale?.excluded_reason ? 0 : (revenue ?? 0);
		// The profile write runs before the session upsert in this transaction, so
		// the sessions row exists only if an earlier request (or an earlier event of
		// this batch) created it: count a session once, on the event that opens it.
		const newSession = sql<number>`CASE WHEN EXISTS (SELECT 1 FROM sessions WHERE id = ${payload.sid} AND site_id = ${payload.s}) THEN 0 ELSE 1 END`;

		writes.push(
			db
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
					total_sessions: newSession,
					total_pageviews: pvInc,
					total_revenue: rvInc,
					fingerprint,
					is_bot: isBot,
				})
				.onConflict((oc) =>
					oc.columns(["site_id", "visitor_id"]).doUpdateSet({
						last_seen: ts,
						// A human session clears an earlier bot verdict; a bot one never sets it.
						is_bot: isBot ? undefined : 0,
						fingerprint: fingerprint ?? undefined,
						country: cfCountry ?? undefined,
						region: cfRegion ?? undefined,
						city: cfCity ?? undefined,
						device_type: deviceType ?? undefined,
						browser: browser ?? undefined,
						os: os ?? undefined,
						total_pageviews: sql`total_pageviews + ${pvInc}`,
						total_sessions: sql`total_sessions + ${newSession}`,
						total_revenue: rvInc > 0 ? sql`total_revenue + ${rvInc}` : undefined,
					}),
				),
		);

		writes.push(
			db
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
					is_bot: isBot,
					bot_reason: botReason,
					active_seconds: 0,
					as_org: cfAsOrg,
				})
				.onConflict((oc) =>
					oc.column("id").doUpdateSet({
						exit_path: payload.p,
						// Out-of-order batches never move the end backwards, and a gap
						// (idle tab, abandoned session) adds at most the cap.
						active_seconds: sql`COALESCE(active_seconds, 0) + CAST(ROUND(MIN(${SESSION_GAP_CAP_SECONDS}, MAX(0, (julianday(${ts}) - julianday(COALESCE(ended_at, started_at))) * 86400))) AS INTEGER)`,
						ended_at: sql`MAX(COALESCE(ended_at, started_at), ${ts})`,
						page_count: sql`page_count + 1`,
						is_bounce: 0,
						is_bot: sql`MAX(is_bot, ${isBot})`,
						bot_reason: sql`COALESCE(bot_reason, ${botReason})`,
					}),
				),
		);

		// A session flagged as a probe taints every event in it, including later
		// events whose own fields look clean.
		writes.push(
			db
				.updateTable("events")
				.set({ is_bot: 1 })
				.where("site_id", "=", payload.s)
				.where("session_id", "=", payload.sid)
				.where("is_bot", "=", 0)
				.where(
					sql<boolean>`EXISTS (SELECT 1 FROM sessions WHERE id = ${payload.sid} AND site_id = ${payload.s} AND bot_reason = 'probe_payload')`,
				),
		);
	}

	// One batch = one D1 transaction, usage first: either all of it lands or none.
	const usage =
		enforcement.ownerId && ingested > 0
			? accountUsageIncrement(db, enforcement.ownerId, ingested)
			: null;
	try {
		await executeBatch(c.env.DB, usage ? [usage, ...writes] : writes, writes.length + 1);
	} catch (err) {
		if (!usage) throw err;
		// Fail open on the counter: keep the events, lose only the usage bump.
		console.error("[track] batch with usage increment failed, retrying without it:", err);
		await executeBatch(c.env.DB, writes, writes.length);
	}
	if (enforcement.ownerId && ingested > 0) incrementCachedUsage(enforcement.ownerId, ingested);

	return c.json({ success: true }, { status: 202 });
});

trackRoutes.post("/identify", async (c) => {
	const db = c.get("db");
	const payload: IdentifyPayload = await c.req.json();
	const siteId = payload.s;
	if (!siteId || !payload.vid)
		return c.json({ error: "site_id and visitor_id required", success: false }, 400);

	const enforcement = await enforceSiteQuota(db, siteId, false, isSelfHosted(c.env));
	if (!enforcement.allowed) {
		return c.json({ success: true, reason: enforcement.reason }, { status: 202 });
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

	const enforcement = await enforceSiteQuota(db, siteId, true, isSelfHosted(c.env));
	if (!enforcement.allowed) {
		return c.json({ success: true, reason: enforcement.reason }, { status: 202 });
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
		return c.json({ error: "Invalid type, expected click or scroll", success: false }, 400);
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
		return c.json({ error: "chunk too large (max 200 events)", success: false }, 400);

	const site = await db
		.selectFrom("sites")
		.select(["id"])
		.where("id", "=", siteId)
		.executeTakeFirst();
	if (!site) return c.json({ error: "Invalid site_id", success: false }, 400);

	const enforcement = await enforceSiteQuota(db, siteId, true, isSelfHosted(c.env));
	if (!enforcement.allowed) {
		return c.json({ success: true, reason: enforcement.reason }, { status: 202 });
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

	const revenue = sanitizeRevenue(amount);
	if (revenue === null) {
		return c.json({ error: "amount must be a number between 0 and 1e9", success: false }, 400);
	}

	const site = await db
		.selectFrom("sites")
		.select(["id", "revenue_currency"])
		.where("id", "=", siteId)
		.executeTakeFirst();
	if (!site) return c.json({ error: "Invalid site_id", success: false }, 400);

	const enforcement = await enforceSiteQuota(db, siteId, false, isSelfHosted(c.env));
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
		// Naming is_bot opts out of the events plugin: a test-excluded payment still owns its id.
		.where("is_bot", "in", [0, 1])
		.where(sql<string>`json_extract(props, '$.transaction_id')`, "=", String(transaction_id))
		.executeTakeFirst();
	if (existing) return c.json({ success: true, event_id: existing.id, duplicate: true });

	const cf = (c.req.raw as Request & { cf?: Record<string, unknown> }).cf;
	const cfCountry = (cf?.country as string) ?? c.req.header("cf-ipcountry") ?? null;
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
	// Server-to-server payments may be backfilled, so only future/invalid times are clamped.
	const ts = resolveEventTimestamp(body.timestamp, Date.now(), Number.POSITIVE_INFINITY);
	const eventId = generateId();
	const paymentCurrency = eventCurrency(body.currency, body.props, site.revenue_currency);
	// `provider` names the rail when props carry no source of their own.
	const saleProps: Record<string, unknown> = {
		...(typeof body.provider === "string" ? { source: body.provider } : {}),
		...body.props,
	};
	const sale =
		revenue > 0
			? await clientSaleFields(db, {
					siteId,
					visitorId: visitorId as string,
					path: "/payment",
					revenue,
					currency: paymentCurrency,
					ts,
					props: saleProps,
					guardDoubleFire: false,
					env: c.env,
				})
			: null;

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
			revenue,
			currency: paymentCurrency,
			...(sale
				? {
						rail: sale.rail,
						product: sale.product,
						payment_provider: sale.payment_provider,
						net_revenue: sale.net_revenue,
						net_source: sale.net_source,
						excluded_reason: sale.excluded_reason,
					}
				: {}),
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
			total_revenue: sale?.excluded_reason ? 0 : revenue,
			fingerprint: null,
		})
		.onConflict((oc) =>
			oc.columns(["site_id", "visitor_id"]).doUpdateSet({
				last_seen: ts,
				total_revenue: sale?.excluded_reason ? undefined : sql`total_revenue + ${revenue}`,
			}),
		)
		.execute();

	if (enforcement.ownerId) {
		try {
			await accountUsageIncrement(db, enforcement.ownerId, 1).execute();
		} catch (err) {
			console.error("[track/payment] usage increment failed:", err);
		}
		incrementCachedUsage(enforcement.ownerId, 1);
	}

	return c.json({ success: true, event_id: eventId, visitor_id: visitorId });
});
