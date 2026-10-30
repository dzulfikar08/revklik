import { Hono } from "hono";
import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { createDb } from "../db";
import { migrateDatabase } from "../migrations";
import type { Env } from "../types";
import { allowRequest } from "../lib/rate-limit";
import { clampTzOffset, getLiveStats, validateWidgetToken } from "../lib/widget-live";

const PUBLIC_LIMIT_PER_MINUTE = 120;

// Public (no auth) live-stats feed for the embeddable widget, gated by the
// per-site widget_token — see routes/sites.ts for the toggle/config endpoints.

export const widgetLiveRoutes = new Hono<Env>();

type Db = Kysely<KlikapaDatabase>;

widgetLiveRoutes.get("/:token", async (c) => {
	const ip = c.req.header("cf-connecting-ip") || "unknown";
	if (!(await allowRequest(c.env.RL_TRACK, `widget:${ip}`, PUBLIC_LIMIT_PER_MINUTE))) {
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
