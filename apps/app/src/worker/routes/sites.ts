import { Hono } from "hono";
import type { Kysely } from "kysely";
import type { CreateSitePayload, KlikapaDatabase, Site, SiteWithStats } from "@revklik/shared";
import { sql } from "../db";
import { getPlanLimits } from "../lib/plans";
import { clampTzOffset } from "../lib/widget-live";
import { fingerprintFromRequest, generateId } from "../utils";
import { invalidateExcludedCache } from "./track";

type Variables = { db: Kysely<KlikapaDatabase>; userId: string };

export const siteRoutes = new Hono<{ Variables: Variables }>();

siteRoutes.get("/", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");

	const sites = await db
		.selectFrom("sites")
		.select(["id", "name", "domain", "created_at"])
		.where("user_id", "=", userId)
		.orderBy("created_at", "desc")
		.execute();

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
		sites.map(async (site) => {
			const [stats, sparkRows, revenueRows] = await Promise.all([
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
					.select([({ fn }) => fn.sum<number>("revenue").as("revenue")])
					.where("site_id", "=", site.id)
					.where("revenue", ">", 0)
					.where("timestamp", ">=", startIso)
					.groupBy(sql`date(${sql.ref("timestamp")})`)
					.orderBy("timestamp", "asc")
					.execute(),
			]);

			return {
				...site,
				pageviews: Number(stats?.pageviews ?? 0),
				visitors: Number(stats?.visitors ?? 0),
				revenue: revenueRows.reduce((sum, r) => sum + Number(r.revenue ?? 0), 0),
				sparkline: sparkRows.map((r) => Number(r.count)),
				revenue_sparkline: revenueRows.map((r) => Number(r.revenue ?? 0)),
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

	// Site limit enforcement (super_admins bypass limits)
	const user = await db
		.selectFrom("users")
		.select(["role"])
		.where("id", "=", userId)
		.executeTakeFirst();
	if (user?.role !== "super_admin") {
		const sub = await db
			.selectFrom("subscriptions")
			.select(["plan", "status", "current_period_end"])
			.where("user_id", "=", userId)
			.executeTakeFirst();
		const plan =
			sub?.status === "active" &&
			(!sub.current_period_end || new Date(sub.current_period_end) >= new Date())
				? sub.plan
				: "micro";
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

	const siteId = generateId();
	await db
		.insertInto("sites")
		.values({
			id: siteId,
			user_id: userId,
			name,
			domain,
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
