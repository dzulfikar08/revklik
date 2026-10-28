import { Hono } from "hono";
import type { Kysely } from "kysely";
import type { CreateSitePayload, KlikapaDatabase, Site, SiteWithStats } from "@revklik/shared";
import { sql } from "../db";
import { isSelfHosted, isSubscriptionActive } from "../lib/entitlement";
import { normalizeCurrency, revenueSql, usdRates } from "../lib/fx";
import { getPlanLimits } from "../lib/plans";
import { purgeSiteRows } from "../lib/purge";
import { displayCurrency } from "../lib/site-scope";
import { clampTzOffset } from "../lib/widget-live";
import { fingerprintFromRequest, generateId } from "../utils";
import { invalidateExcludedCache } from "./track";

type Variables = { db: Kysely<KlikapaDatabase>; userId: string };

export const siteRoutes = new Hono<{
	Variables: Variables;
	Bindings: { FX_USD_IDR?: string; DB: D1Database; SELF_HOSTED?: string };
}>();

/**
 * Bare host for a site: scheme, credentials, path, query, port, trailing dot
 * and a leading "www." are dropped, lowercase. Ingest is keyed by site id,
 * not host, and the GSC matcher already ignores www, so nothing depends on
 * the prefix. Returns null when no plausible hostname remains.
 */
export function normalizeDomain(raw: string): string | null {
	let host = raw.trim().toLowerCase();
	host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
	host = host.replace(/^[^@/]*@/, "");
	host = host.split(/[/?#]/)[0] ?? "";
	host = host
		.replace(/:\d+$/, "")
		.replace(/\.+$/, "")
		.replace(/^www\./, "");
	return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(host)
		? host
		: null;
}

siteRoutes.get("/", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");

	const sites = await db
		.selectFrom("sites")
		.select(["id", "name", "domain", "created_at", "revenue_currency"])
		.where("user_id", "=", userId)
		.orderBy("created_at", "desc")
		.execute();
	const rates = usdRates(c.env);

	const rangeParam = c.req.query("range") || "7d";
	let startIso: string;
	if (rangeParam.includes(",")) {
		startIso = new Date(rangeParam.split(",")[0] ?? "").toISOString();
	} else {
		const days: Record<string, number> = {
			"24h": 1,
			"7d": 7,
			"30d": 30,
			"90d": 90,
		};
		startIso = new Date(Date.now() - (days[rangeParam] ?? 7) * 86400000).toISOString();
	}

	const sitesWithStats: SiteWithStats[] = await Promise.all(
		sites.map(async ({ revenue_currency, ...site }) => {
			const money = { currency: displayCurrency(revenue_currency, rates), rates };
			const [stats, sparkRows, revenueRows, anyEvent] = await Promise.all([
				db
					.selectFrom("events")
					.select([
						({ fn }) => fn.count<number>("id").as("pageviews"),
						({ fn }) => fn.count<number>("visitor_id").distinct().as("visitors"),
					])
					.where("site_id", "=", site.id)
					.where("event_type", "=", "pageview")
					.where("timestamp", ">=", startIso)
					.executeTakeFirst(),
				db
					.selectFrom("events")
					.select([({ fn }) => fn.count<number>("id").as("count")])
					.where("site_id", "=", site.id)
					.where("event_type", "=", "pageview")
					.where("timestamp", ">=", startIso)
					.groupBy(sql`date(${sql.ref("timestamp")})`)
					.orderBy("timestamp", "asc")
					.execute(),
				// Daily revenue across all event types (revenue can ride on conversions too).
				db
					.selectFrom("events")
					.select([sql<number>`SUM(${revenueSql(money)})`.as("revenue")])
					.where("site_id", "=", site.id)
					.where("revenue", "!=", 0)
					.where("timestamp", ">=", startIso)
					.groupBy(sql`date(${sql.ref("timestamp")})`)
					.orderBy("timestamp", "asc")
					.execute(),
				// Ever received anything: drives the "Not installed" badge.
				db
					.selectFrom("events")
					.select("id")
					.where("site_id", "=", site.id)
					.where("is_bot", "in", [0, 1])
					.limit(1)
					.executeTakeFirst(),
			]);

			return {
				...site,
				pageviews: Number(stats?.pageviews ?? 0),
				visitors: Number(stats?.visitors ?? 0),
				revenue: revenueRows.reduce((sum, r) => sum + Number(r.revenue ?? 0), 0),
				sparkline: sparkRows.map((r) => Number(r.count)),
				revenue_sparkline: revenueRows.map((r) => Number(r.revenue ?? 0)),
				currency: money.currency,
				has_events: !!anyEvent,
			};
		}),
	);

	return c.json({ data: sitesWithStats, success: true });
});

siteRoutes.post("/", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	const { name, domain: rawDomain } = await c.req.json<CreateSitePayload>();
	if (!name || !rawDomain)
		return c.json({ error: "Name and domain required", success: false }, 400);
	const domain = normalizeDomain(rawDomain);
	if (!domain) return c.json({ error: "Invalid domain", success: false }, 400);

	// Site limit enforcement (super_admins bypass limits)
	const user = await db
		.selectFrom("users")
		.select(["role"])
		.where("id", "=", userId)
		.executeTakeFirst();
	if (user?.role !== "super_admin" && !isSelfHosted(c.env)) {
		const sub = await db
			.selectFrom("subscriptions")
			.select(["plan", "status", "current_period_end"])
			.where("user_id", "=", userId)
			.executeTakeFirst();
		// Trials get their trial plan's limit; lapsed accounts fall back to micro.
		const plan = sub && isSubscriptionActive(sub) ? sub.plan : "micro";
		const limits = getPlanLimits(plan);
		const siteCount = await db
			.selectFrom("sites")
			.select(({ fn }) => fn.count<number>("id").as("cnt"))
			.where("user_id", "=", userId)
			.executeTakeFirst();
		if (Number(siteCount?.cnt ?? 0) >= limits.sites) {
			return c.json(
				{
					error: `Site limit reached (${limits.sites} for ${limits.name} plan). Upgrade to create more sites.`,
					success: false,
					quota: {
						limit: limits.sites,
						used: Number(siteCount?.cnt ?? 0),
						plan,
					},
				},
				403,
			);
		}
	}

	// Indonesia-first: a site created from ID starts in IDR so its revenue is not
	// shown converted to USD.
	const country =
		(c.req.raw.cf as { country?: string } | undefined)?.country ||
		c.req.header("CF-IPCountry") ||
		"";
	const siteId = generateId();
	await db
		.insertInto("sites")
		.values({
			id: siteId,
			user_id: userId,
			name,
			domain,
			revenue_currency: country.toUpperCase() === "ID" ? "IDR" : "USD",
			revenue_currency_source: "default",
			created_at: new Date().toISOString(),
			share_token: null,
			public_dashboard: 0,
		})
		.execute();

	return c.json(
		{
			data: {
				id: siteId,
				name,
				domain,
				created_at: new Date().toISOString(),
			} as Site,
			success: true,
		},
		201,
	);
});

siteRoutes.delete("/:siteId", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	const siteId = c.req.param("siteId");
	const site = await db
		.selectFrom("sites")
		.select(["id"])
		.where("id", "=", siteId)
		.where("user_id", "=", userId)
		.executeTakeFirst();
	if (!site) return c.json({ error: "Site not found", success: false }, 404);

	// Dependents first, in bounded chunks; the site row goes only once every
	// table ran dry. A very large site answers 202 and finishes on the next DELETE.
	const purge = await purgeSiteRows(c.env.DB, siteId);
	if (purge.unfinished.length > 0) {
		return c.json(
			{ data: { status: "deleting", remaining_tables: purge.unfinished }, success: true },
			202,
		);
	}
	await db.deleteFrom("sites").where("id", "=", siteId).execute();
	return c.json({ success: true });
});

// Revenue display currency; rows in other currencies are converted at query time.
siteRoutes.patch("/:siteId", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	const siteId = c.req.param("siteId");
	const body = await c.req.json<{ revenue_currency?: unknown }>().catch(() => ({}) as never);
	const site = await db
		.selectFrom("sites")
		.select(["id"])
		.where("id", "=", siteId)
		.where("user_id", "=", userId)
		.executeTakeFirst();
	if (!site) return c.json({ error: "Site not found", success: false }, 404);

	const rates = usdRates(c.env);
	const currency = normalizeCurrency(body?.revenue_currency);
	if (!currency || !(currency in rates)) {
		return c.json(
			{
				error: `revenue_currency must be one of: ${Object.keys(rates).join(", ")}`,
				success: false,
			},
			400,
		);
	}
	await db
		.updateTable("sites")
		.set({ revenue_currency: currency, revenue_currency_source: "user" })
		.where("id", "=", siteId)
		.execute();
	return c.json({ data: { id: siteId, revenue_currency: currency }, success: true });
});

siteRoutes.get("/:siteId/snippet", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	const siteId = c.req.param("siteId");
	const site = await db
		.selectFrom("sites")
		.select(["id", "name", "domain"])
		.where("id", "=", siteId)
		.where("user_id", "=", userId)
		.executeTakeFirst();
	if (!site) return c.json({ error: "Site not found", success: false }, 404);

	const origin = new URL(c.req.url).origin;
	const snippet = siteSnippet(origin, siteId);
	return c.json({ data: { siteId, snippet }, success: true });
});

/**
 * The tracker (public/klikapa.js) reads ONLY the data-site-id attribute and
 * derives its endpoint from the script src — window.klikapa_site_id and
 * window.klikapa_endpoint are ignored, so the legacy globals emitted a dead
 * snippet. Keep this aligned with docs.txt.
 */
export function siteSnippet(origin: string, siteId: string): string {
	return `<script defer data-site-id="${siteId}" src="${origin}/klikapa.js"></script>`;
}
// ---------- Self-traffic exclusion (fingerprint blocklist) ----------

function parseExcluded(raw: string | null | undefined): string[] {
	if (!raw) return [];
	try {
		const v = JSON.parse(raw);
		return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
	} catch {
		return [];
	}
}

async function loadSiteForOwner(db: Kysely<KlikapaDatabase>, userId: string, siteId: string) {
	return db
		.selectFrom("sites")
		.select(["id", "excluded_fingerprints"])
		.where("id", "=", siteId)
		.where("user_id", "=", userId)
		.executeTakeFirst();
}

// Compute the caller's current fingerprint (same algorithm as ingest).
siteRoutes.get("/:siteId/my-fingerprint", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	const siteId = c.req.param("siteId");
	const site = await loadSiteForOwner(db, userId, siteId);
	if (!site) return c.json({ error: "Site not found", success: false }, 404);
	const fingerprint = await fingerprintFromRequest(c.req.raw);
	return c.json({ data: { fingerprint }, success: true });
});

siteRoutes.get("/:siteId/exclusions", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	const siteId = c.req.param("siteId");
	const site = await loadSiteForOwner(db, userId, siteId);
	if (!site) return c.json({ error: "Site not found", success: false }, 404);
	return c.json({
		data: parseExcluded(site.excluded_fingerprints),
		success: true,
	});
});

siteRoutes.post("/:siteId/exclusions", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	const siteId = c.req.param("siteId");
	const site = await loadSiteForOwner(db, userId, siteId);
	if (!site) return c.json({ error: "Site not found", success: false }, 404);

	const body = await c.req.json().catch(() => ({}));
	// Body may pass { fingerprint }; otherwise derive from the current request.
	let fingerprint: string =
		typeof body?.fingerprint === "string" && body.fingerprint.length > 0
			? body.fingerprint
			: await fingerprintFromRequest(c.req.raw);
	if (!fingerprint) return c.json({ error: "Could not resolve fingerprint", success: false }, 400);

	const list = parseExcluded(site.excluded_fingerprints);
	if (!list.includes(fingerprint)) list.push(fingerprint);
	await db
		.updateTable("sites")
		.set({ excluded_fingerprints: JSON.stringify(list) })
		.where("id", "=", siteId)
		.execute();
	invalidateExcludedCache(siteId);
	return c.json({ data: list, success: true });
});

siteRoutes.delete("/:siteId/exclusions/:fp", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	const siteId = c.req.param("siteId");
	const fp = c.req.param("fp");
	const site = await loadSiteForOwner(db, userId, siteId);
	if (!site) return c.json({ error: "Site not found", success: false }, 404);
	const list = parseExcluded(site.excluded_fingerprints).filter((x) => x !== fp);
	await db
		.updateTable("sites")
		.set({ excluded_fingerprints: JSON.stringify(list) })
		.where("id", "=", siteId)
		.execute();
	invalidateExcludedCache(siteId);
	return c.json({ data: list, success: true });
});

// Purge all historical data for a fingerprint (events / sessions / visitor_profiles).
siteRoutes.post("/:siteId/purge", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	const siteId = c.req.param("siteId");
	const site = await loadSiteForOwner(db, userId, siteId);
	if (!site) return c.json({ error: "Site not found", success: false }, 404);

	const body = await c.req.json().catch(() => ({}));
	const fingerprint: string =
		typeof body?.fingerprint === "string" && body.fingerprint.length > 0
			? body.fingerprint
			: await fingerprintFromRequest(c.req.raw);
	if (!fingerprint) return c.json({ error: "Could not resolve fingerprint", success: false }, 400);

	const [events, sessions, profiles] = await Promise.all([
		db
			.deleteFrom("events")
			.where("site_id", "=", siteId)
			.where("fingerprint", "=", fingerprint)
			.executeTakeFirst(),
		db
			.deleteFrom("sessions")
			.where("site_id", "=", siteId)
			.where("fingerprint", "=", fingerprint)
			.executeTakeFirst(),
		db
			.deleteFrom("visitor_profiles")
			.where("site_id", "=", siteId)
			.where("fingerprint", "=", fingerprint)
			.executeTakeFirst(),
	]);
	return c.json({
		data: {
			events: Number(events.numDeletedRows ?? 0),
			sessions: Number(sessions.numDeletedRows ?? 0),
			profiles: Number(profiles.numDeletedRows ?? 0),
		},
		success: true,
	});
});

// ---------- Embeddable live-stats widget (public endpoint is /api/widgets/live/:token) ----------

async function loadWidgetForOwner(db: Kysely<KlikapaDatabase>, userId: string, siteId: string) {
	return db
		.selectFrom("sites")
		.select(["id", "widget_enabled", "widget_token", "widget_tz_offset"])
		.where("id", "=", siteId)
		.where("user_id", "=", userId)
		.executeTakeFirst();
}

siteRoutes.get("/:siteId/widget/status", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	const site = await loadWidgetForOwner(db, userId, c.req.param("siteId"));
	if (!site) return c.json({ error: "Site not found", success: false }, 404);
	return c.json({
		data: {
			enabled: site.widget_enabled === 1,
			widget_token: site.widget_token ?? null,
			tz_offset: clampTzOffset(site.widget_tz_offset ?? 0) ?? 0,
		},
		success: true,
	});
});

siteRoutes.post("/:siteId/widget/toggle", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	const siteId = c.req.param("siteId");
	const site = await loadWidgetForOwner(db, userId, siteId);
	if (!site) return c.json({ error: "Site not found", success: false }, 404);

	if (site.widget_enabled === 1) {
		await db
			.updateTable("sites")
			.set({ widget_enabled: 0, widget_token: null })
			.where("id", "=", siteId)
			.execute();
		return c.json({ data: { enabled: false, widget_token: null }, success: true });
	}

	const token = site.widget_token || generateId();
	await db
		.updateTable("sites")
		.set({ widget_enabled: 1, widget_token: token })
		.where("id", "=", siteId)
		.execute();
	return c.json({ data: { enabled: true, widget_token: token }, success: true });
});

siteRoutes.post("/:siteId/widget/regenerate", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	const siteId = c.req.param("siteId");
	const site = await loadWidgetForOwner(db, userId, siteId);
	if (!site) return c.json({ error: "Site not found", success: false }, 404);
	if (site.widget_enabled !== 1) {
		return c.json({ error: "Widget is not enabled", success: false }, 400);
	}

	const token = generateId();
	await db.updateTable("sites").set({ widget_token: token }).where("id", "=", siteId).execute();
	return c.json({ data: { widget_token: token }, success: true });
});

siteRoutes.patch("/:siteId/widget/config", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	const siteId = c.req.param("siteId");
	const site = await loadWidgetForOwner(db, userId, siteId);
	if (!site) return c.json({ error: "Site not found", success: false }, 404);

	const body = await c.req.json().catch(() => ({}));
	const tzOffset = clampTzOffset(Number(body?.tz_offset));
	if (tzOffset === null) {
		return c.json(
			{ error: "tz_offset must be an integer between -840 and 840", success: false },
			400,
		);
	}

	await db
		.updateTable("sites")
		.set({ widget_tz_offset: tzOffset })
		.where("id", "=", siteId)
		.execute();
	return c.json({ data: { tz_offset: tzOffset }, success: true });
});
