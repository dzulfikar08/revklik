import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { createDb } from "../db";
import { getOverviewStats, getReferrers } from "../queries/analytics";
import { classifyIngestSignals, classifySession, type SessionFeatures } from "./bot-detection";
import { reclassifyBots } from "./bot-reclassify";
import { migrateDatabase } from "../migrations";
import { makeD1 } from "./test-harness";

const iso = (base: number, offsetMs = 0) => new Date(base + offsetMs).toISOString();

async function migratedDb() {
	const db = new Database(":memory:");
	const d1 = makeD1(db) as unknown as D1Database;
	await migrateDatabase(d1);
	return { db, d1 };
}

interface SeedEvent {
	id?: string;
	session: string;
	visitor: string;
	ts: string;
	type?: string;
	name?: string | null;
	city?: string | null;
	os?: string | null;
	referrer?: string | null;
	utm?: string | null;
	bot?: number;
	revenue?: number | null;
}

function seedEvent(db: Database, e: SeedEvent) {
	db.prepare(
		`INSERT INTO events (id, site_id, session_id, visitor_id, timestamp, event_type, name, path, city, os, referrer, utm_source, is_bot, revenue)
		 VALUES (?, 's1', ?, ?, ?, ?, ?, '/', ?, ?, ?, ?, ?, ?)`,
	).run(
		e.id ?? crypto.randomUUID(),
		e.session,
		e.visitor,
		e.ts,
		e.type ?? "pageview",
		e.name ?? null,
		e.city ?? null,
		e.os ?? null,
		e.referrer ?? null,
		e.utm ?? null,
		e.bot ?? 0,
		e.revenue ?? null,
	);
}

function seedSession(
	db: Database,
	id: string,
	visitor: string,
	startedAt: string,
	extra: { city?: string; os?: string; bot?: number; reason?: string } = {},
) {
	db.prepare(
		"INSERT INTO sessions (id, site_id, visitor_id, started_at, city, os, device_type, is_bot, bot_reason) VALUES (?, 's1', ?, ?, ?, ?, 'desktop', ?, ?)",
	).run(
		id,
		visitor,
		startedAt,
		extra.city ?? null,
		extra.os ?? null,
		extra.bot ?? 0,
		extra.reason ?? null,
	);
	db.prepare(
		"INSERT OR IGNORE INTO visitor_profiles (id, site_id, visitor_id) VALUES (?, 's1', ?)",
	).run(`vp-${visitor}`, visitor);
}

const features = (over: Partial<SessionFeatures> = {}): SessionFeatures => ({
	city: "Jakarta",
	os: "Windows",
	deviceType: "desktop",
	asOrg: null,
	events: 12,
	pageviews: 2,
	clicks: 3,
	spanSeconds: 90,
	maxScrollSameMs: 1,
	quickPageviewGaps: 0,
	existingReason: null,
	...over,
});

describe("classifyIngestSignals", () => {
	it("flags automation, low bot score, hosting networks and datacenter cities", () => {
		expect(classifyIngestSignals({ webdriver: true })).toBe("webdriver");
		expect(classifyIngestSignals({ botScore: 5 })).toBe("bot_score");
		expect(classifyIngestSignals({ asOrganization: "Hetzner Online GmbH" })).toBe("datacenter_org");
		expect(classifyIngestSignals({ city: "Ashburn" })).toBe("datacenter_city");
		expect(classifyIngestSignals({ city: "Surabaya", botScore: 90 })).toBeNull();
		expect(classifyIngestSignals({})).toBeNull();
	});
});

describe("classifySession", () => {
	it("keeps people: reads, clicks and slow navigation are never flagged", () => {
		expect(classifySession(features())).toBeNull();
		// A fast but real fling: several milestones in one ms, yet seconds into the visit.
		expect(classifySession(features({ maxScrollSameMs: 4, spanSeconds: 9, clicks: 0 }))).toBeNull();
		// Same burst, but the visitor clicked: a person.
		expect(classifySession(features({ maxScrollSameMs: 4, spanSeconds: 2, clicks: 1 }))).toBeNull();
		// A Linux user who scrolled is a second event, not a passive hit.
		expect(classifySession(features({ os: "Linux", events: 4, pageviews: 1 }))).toBeNull();
	});

	it("flags physically impossible sessions", () => {
		expect(classifySession(features({ maxScrollSameMs: 4, spanSeconds: 0.05, clicks: 0 }))).toBe(
			"scroll_burst",
		);
		expect(classifySession(features({ maxScrollSameMs: 4, spanSeconds: 2.4, clicks: 0 }))).toBe(
			"scroll_burst",
		);
		expect(classifySession(features({ quickPageviewGaps: 3 }))).toBe("pageview_burst");
		expect(classifySession(features({ clicks: 1284 }))).toBe("click_flood");
	});

	it("flags datacenter cities and passive Linux hits, and keeps ingest-only verdicts", () => {
		expect(classifySession(features({ city: "Ashburn" }))).toBe("datacenter_city");
		expect(classifySession(features({ os: "Linux", events: 1, pageviews: 1 }))).toBe(
			"passive_linux_hit",
		);
		expect(classifySession(features({ existingReason: "webdriver" }))).toBe("webdriver");
		// A behavioral verdict is recomputed, so a relaxed rule can clear it.
		expect(classifySession(features({ existingReason: "scroll_burst" }))).toBeNull();
	});
});

describe("BotFilterPlugin", () => {
	it("hides flagged rows from every select, subqueries and joins included", async () => {
		const { db, d1 } = await migratedDb();
		const t0 = Date.now() - 3_600_000;
		seedSession(db, "human", "vh", iso(t0));
		seedSession(db, "robot", "vb", iso(t0), { bot: 1, reason: "scroll_burst" });
		seedEvent(db, { session: "human", visitor: "vh", ts: iso(t0) });
		seedEvent(db, { session: "robot", visitor: "vb", ts: iso(t0), bot: 1 });
		const kysely = createDb(d1);

		const events = await kysely.selectFrom("events").select("visitor_id").execute();
		expect(events.map((e) => e.visitor_id)).toEqual(["vh"]);

		const nested = await kysely
			.selectFrom("sessions")
			.select("id")
			.where((eb) =>
				eb.exists(
					eb.selectFrom("events").select("id").whereRef("events.session_id", "=", "sessions.id"),
				),
			)
			.execute();
		expect(nested.map((s) => s.id)).toEqual(["human"]);

		const joined = await kysely
			.selectFrom("sessions")
			.innerJoin("events", "events.session_id", "sessions.id")
			.select("sessions.id")
			.execute();
		expect(joined.map((s) => s.id)).toEqual(["human"]);

		const aliased = await kysely.selectFrom("events as e").select("e.visitor_id").execute();
		expect(aliased).toHaveLength(1);
	});

	it("lets a query that names is_bot count every row (usage metering)", async () => {
		const { db, d1 } = await migratedDb();
		seedEvent(db, { session: "a", visitor: "v1", ts: iso(Date.now()), bot: 1 });
		seedEvent(db, { session: "b", visitor: "v2", ts: iso(Date.now()) });
		const all = await createDb(d1)
			.selectFrom("events")
			.select("id")
			.where("is_bot", "in", [0, 1])
			.execute();
		expect(all).toHaveLength(2);
	});
});

describe("reclassifyBots", () => {
	it("flags bursts and datacenter sessions, propagates to events and profiles, is idempotent", async () => {
		const { db, d1 } = await migratedDb();
		const t0 = Date.now() - 2 * 3_600_000;

		// Scripted visit: pageview then 4 scroll milestones in the same millisecond.
		seedSession(db, "burst", "v-burst", iso(t0), { os: "Windows", city: "Singapore" });
		seedEvent(db, { session: "burst", visitor: "v-burst", ts: iso(t0) });
		for (let milestone = 0; milestone < 4; milestone++) {
			seedEvent(db, {
				session: "burst",
				visitor: "v-burst",
				ts: iso(t0, 40),
				type: "custom",
				name: "scroll",
			});
		}

		// Datacenter city, single pageview.
		seedSession(db, "dc", "v-dc", iso(t0), { city: "Ashburn", os: "Windows" });
		seedEvent(db, { session: "dc", visitor: "v-dc", ts: iso(t0), city: "Ashburn" });

		// Person: pageview, a click 20 s later, scroll 25 s later.
		seedSession(db, "human", "v-human", iso(t0), { city: "Surabaya", os: "Windows" });
		seedEvent(db, { session: "human", visitor: "v-human", ts: iso(t0) });
		seedEvent(db, {
			session: "human",
			visitor: "v-human",
			ts: iso(t0, 20_000),
			type: "custom",
			name: "click",
		});
		seedEvent(db, {
			session: "human",
			visitor: "v-human",
			ts: iso(t0, 25_000),
			type: "custom",
			name: "scroll",
		});

		const dry = await reclassifyBots(d1, { siteId: "s1", dryRun: true });
		expect(dry).toMatchObject({ sessions: 3, bots: 2, flagged: 2 });
		expect(db.query("SELECT COUNT(*) AS n FROM sessions WHERE is_bot = 1").get()).toEqual({ n: 0 });

		const run = await reclassifyBots(d1, { siteId: "s1", recomputeDurations: true });
		expect(run.byReason).toEqual({ scroll_burst: 1, datacenter_city: 1 });

		const flagged = db
			.query("SELECT id, bot_reason FROM sessions WHERE is_bot = 1 ORDER BY id")
			.all();
		expect(flagged).toEqual([
			{ id: "burst", bot_reason: "scroll_burst" },
			{ id: "dc", bot_reason: "datacenter_city" },
		]);
		expect(db.query("SELECT COUNT(*) AS n FROM events WHERE is_bot = 1").get()).toEqual({ n: 6 });
		expect(
			db
				.query("SELECT visitor_id FROM visitor_profiles WHERE is_bot = 1 ORDER BY visitor_id")
				.all(),
		).toEqual([{ visitor_id: "v-burst" }, { visitor_id: "v-dc" }]);
		expect(db.query("SELECT active_seconds AS s FROM sessions WHERE id = 'human'").get()).toEqual({
			s: 25,
		});

		const again = await reclassifyBots(d1, { siteId: "s1" });
		expect(again.flagged).toBe(0);
		expect(again.bots).toBe(2);
	});

	it("caps each idle gap so an abandoned tab adds 30 minutes, not hours", async () => {
		const { db, d1 } = await migratedDb();
		const t0 = Date.now() - 12 * 3_600_000;
		seedSession(db, "idle", "v-idle", iso(t0), { os: "Windows", city: "Jakarta" });
		seedEvent(db, { session: "idle", visitor: "v-idle", ts: iso(t0) });
		seedEvent(db, {
			session: "idle",
			visitor: "v-idle",
			ts: iso(t0, 10_000),
			type: "custom",
			name: "click",
		});
		seedEvent(db, {
			session: "idle",
			visitor: "v-idle",
			ts: iso(t0, 10_000 + 6 * 3_600_000),
			type: "custom",
			name: "click",
		});
		db.prepare("UPDATE sessions SET ended_at = ? WHERE id = 'idle'").run(
			iso(t0, 10_000 + 6 * 3_600_000),
		);

		await reclassifyBots(d1, { siteId: "s1", recomputeDurations: true });
		expect(db.query("SELECT active_seconds AS s FROM sessions WHERE id = 'idle'").get()).toEqual({
			s: 1810,
		});

		const stats = await getOverviewStats(createDb(d1), "s1", iso(t0 - 1000));
		expect(stats.avgDuration).toBe(1810);
	});
});

describe("source normalization", () => {
	it("merges short utm_source names and hostnames into one source", async () => {
		const { db, d1 } = await migratedDb();
		const now = Date.now();
		const sources: Array<[string, string | null, string | null]> = [
			["v1", "bing", null],
			["v2", null, "https://www.bing.com/search?q=x"],
			["v3", "bing.com", null],
			["v4", "duckduckgo", null],
			["v5", null, "https://duckduckgo.com/"],
			["v6", "google", null],
			["v7", null, "https://www.google.co.id/"],
			["v8", null, "https://m.facebook.com/"],
			["v9", "facebook", null],
			["v10", null, null],
			["v11", "newsletter", null],
		];
		for (const [visitor, utm, referrer] of sources) {
			seedEvent(db, { session: `s-${visitor}`, visitor, ts: iso(now - 60_000), utm, referrer });
		}
		// Custom events carry no referrer: they must not file a visitor under "direct".
		seedEvent(db, {
			session: "s-v1",
			visitor: "v1",
			ts: iso(now - 30_000),
			type: "custom",
			name: "click",
		});
		// Navigation inside the site (or its subdomains) is not a traffic source.
		db.prepare(
			"INSERT INTO sites (id, user_id, name, domain) VALUES ('s1', 'u', 'S', 'example.com')",
		).run();
		seedEvent(db, {
			session: "s-v12",
			visitor: "v12",
			ts: iso(now - 60_000),
			referrer: "https://example.com/pricing",
		});
		seedEvent(db, {
			session: "s-v13",
			visitor: "v13",
			ts: iso(now - 60_000),
			referrer: "https://app.example.com/",
		});
		const rows = await getReferrers(createDb(d1), "s1", iso(now - 3_600_000), 20);
		const bySource = Object.fromEntries(rows.map((r) => [r.source, r.visitors]));
		expect(bySource).toEqual({
			"bing.com": 3,
			"duckduckgo.com": 2,
			"google.com": 2,
			facebook: 2,
			direct: 1,
			newsletter: 1,
		});
	});
});
