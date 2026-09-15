import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { createApp } from "../app";
import { makeD1 } from "../lib/test-harness";

/**
 * Route-level tests for GET /api/public/:token/live. The migration module's
 * process-wide guard means migrations cannot run again in this file, so the
 * minimal sites/events tables are created directly.
 */
function createPublicTables(db: Database): void {
	db.exec(`
		CREATE TABLE IF NOT EXISTS sites (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, domain TEXT NOT NULL, share_token TEXT, public_dashboard INTEGER NOT NULL DEFAULT 0, widget_tz_offset INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));
		CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, session_id TEXT NOT NULL, visitor_id TEXT NOT NULL, timestamp TEXT NOT NULL DEFAULT (datetime('now')), event_type TEXT NOT NULL DEFAULT 'pageview', name TEXT, path TEXT NOT NULL, hostname TEXT, referrer TEXT, utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, utm_term TEXT, utm_content TEXT, country TEXT, region TEXT, city TEXT, device_type TEXT, browser TEXT, os TEXT, revenue REAL, props TEXT);
	`);
}

function seedSite(db: Database, opts: { publicDashboard?: number } = {}): void {
	db.prepare(
		"INSERT INTO sites (id, user_id, name, domain, share_token, public_dashboard, widget_tz_offset) VALUES (?,?,?,?,?,?,?)",
	).run("s1", "u1", "Site", "example.com", "share-tok-123", opts.publicDashboard ?? 1, 420);
}

function seedEvents(db: Database): void {
	const now = Date.now();
	const insert =
		"INSERT INTO events (id, site_id, session_id, visitor_id, timestamp, path) VALUES (?,?,?,?,?,?)";
	// One visitor online right now, one earlier today, one from yesterday.
	db.prepare(insert).run("e1", "s1", "ses1", "v-online", new Date(now - 60_000).toISOString(), "/");
	db.prepare(insert).run(
		"e2",
		"s1",
		"ses2",
		"v-today",
		new Date(now - 3 * 3_600_000).toISOString(),
		"/",
	);
	db.prepare(insert).run(
		"e3",
		"s1",
		"ses3",
		"v-old",
		new Date(now - 30 * 86_400_000).toISOString(),
		"/",
	);
}

describe("GET /api/public/:token/live", () => {
	it("serves live stats for an enabled public dashboard and 404s otherwise", async () => {
		const db = new Database(":memory:");
		createPublicTables(db);
		const d1 = makeD1(db);
		const app = createApp();
		const env = { DB: d1, ASSETS: { fetch: async () => new Response("nf", { status: 404 }) } };

		// Disabled dashboard → 404.
		seedSite(db, { publicDashboard: 0 });
		seedEvents(db);
		const off = await app.request("/api/public/share-tok-123/live", undefined, env);
		expect(off.status).toBe(404);
		// Enabling the dashboard unlocks the feed.
		db.prepare("UPDATE sites SET public_dashboard = 1 WHERE id = 's1'").run();
		const res = await app.request("/api/public/share-tok-123/live", undefined, env);
		expect(res.status).toBe(200);
		expect(res.headers.get("Cache-Control")).toContain("max-age=15");
		const body = (await res.json()) as {
			success: boolean;
			data: {
				online_now: number;
				visitors_today: number;
				total_visitors: number;
				updated_at: string;
			};
		};
		expect(body.success).toBe(true);
		expect(body.data.online_now).toBe(1);
		expect(body.data.visitors_today).toBe(2);
		expect(body.data.total_visitors).toBe(3);
		expect(body.data.updated_at).toBeTruthy();

		// Unknown token → 404 (same shape as the disabled case).
		const missing = await app.request("/api/public/nope-not-real/live", undefined, env);
		expect(missing.status).toBe(404);

		// Malformed token → 404 without touching the DB.
		const junk = await app.request("/api/public/../etc/live", undefined, env);
		expect(junk.status).toBe(404);
	});

	it("rate-limits bursts per IP with 429", async () => {
		const db = new Database(":memory:");
		createPublicTables(db);
		const d1 = makeD1(db);
		seedSite(db);
		seedEvents(db);
		const app = createApp();
		const env = { DB: d1, ASSETS: { fetch: async () => new Response("nf", { status: 404 }) } };
		const headers = { "cf-connecting-ip": "203.0.113.7" };

		let lastStatus = 0;
		let saw429 = false;
		for (let i = 0; i < 130; i++) {
			const res = await app.request("/api/public/share-tok-123/live", { headers }, env);
			lastStatus = res.status;
			if (res.status === 429) {
				saw429 = true;
				break;
			}
			await res.body?.cancel();
		}
		expect(saw429).toBe(true);
		expect(lastStatus).toBe(429);
	});
});
