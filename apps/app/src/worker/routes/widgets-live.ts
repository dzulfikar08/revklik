import { Hono } from "hono";
import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { createDb } from "../db";
import { migrateDatabase } from "../migrations";
import type { Env } from "../types";
import { clampTzOffset, getLiveStats, validateWidgetToken } from "../lib/widget-live";

// Public (no auth) live-stats feed for the embeddable widget, gated by the
// per-site widget_token — see routes/sites.ts for the toggle/config endpoints.

export const widgetLiveRoutes = new Hono<Env>();

type Db = Kysely<KlikapaDatabase>;

// In-memory rate limiter (per-isolate, resets on Worker recycle) — mirrors routes/track.ts
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

widgetLiveRoutes.get("/:token", async (c) => {
	const ip = c.req.header("cf-connecting-ip") || "unknown";
	if (!rateLimit(ip, 120, 60_000)) {
		return c.json({ error: "Too many requests", success: false }, 429);
	}

	const token = c.req.param("token");
	if (!validateWidgetToken(token)) {
		return c.json({ error: "Widget not found", success: false }, 404);
	}

	// Defensive: the global migration middleware normally provides db, but
	// fall back to a local handle like the /public/:token handler does.
	let db = c.get("db") as Db | undefined;
	if (!db && c.env.DB) {
		try {
			await migrateDatabase(c.env.DB);
		} catch {}
		db = createDb(c.env.DB);
	}
	if (!db) return c.json({ error: "DB unavailable", success: false }, 503);

	const site = await db
		.selectFrom("sites")
		.select(["id", "widget_tz_offset"])
		.where("widget_token", "=", token)
		.where("widget_enabled", "=", 1)
		.executeTakeFirst();
	if (!site) return c.json({ error: "Widget not found", success: false }, 404);

	const tzOffset = clampTzOffset(site.widget_tz_offset ?? 0) ?? 0;
	const stats = await getLiveStats(db, site.id, tzOffset);

	return c.json({ data: { ...stats, updated_at: new Date().toISOString() }, success: true }, 200, {
		"Cache-Control": "public, max-age=15, s-maxage=15",
	});
});
