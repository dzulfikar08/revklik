import { describe, expect, it } from "bun:test";
import type { D1Database } from "@cloudflare/workers-types";
import { Database } from "bun:sqlite";
import { createDb } from "../db";
import { makeD1 } from "../lib/test-harness";
import { queryJourneys, type PublicJourney } from "./public-api-queries";

/**
 * Path drill-down for /api/v1/analytics/journeys and the MCP
 * visitor_journeys tool: only sessions containing a PAGEVIEW whose path
 * equals or lives under the given prefix ("slash-safe"), while custom events
 * sharing the path never widen the match.
 */
function createTables(db: Database): void {
	db.exec(`
		CREATE TABLE IF NOT EXISTS sites (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, domain TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
		CREATE TABLE IF NOT EXISTS team_members (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, user_id TEXT NOT NULL, accepted_at TEXT);
		CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, is_bot INTEGER NOT NULL DEFAULT 0, active_seconds INTEGER, site_id TEXT NOT NULL, visitor_id TEXT NOT NULL, started_at TEXT NOT NULL DEFAULT (datetime('now')), ended_at TEXT, entry_path TEXT, exit_path TEXT, referrer TEXT, utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, country TEXT, region TEXT, city TEXT, device_type TEXT, browser TEXT, os TEXT, page_count INTEGER NOT NULL DEFAULT 1, is_bounce INTEGER NOT NULL DEFAULT 1);
		CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, is_bot INTEGER NOT NULL DEFAULT 0, site_id TEXT NOT NULL, session_id TEXT NOT NULL, visitor_id TEXT NOT NULL, timestamp TEXT NOT NULL DEFAULT (datetime('now')), event_type TEXT NOT NULL DEFAULT 'pageview', name TEXT, path TEXT NOT NULL, revenue REAL, props TEXT);
		CREATE TABLE IF NOT EXISTS visitor_profiles (id TEXT PRIMARY KEY, is_bot INTEGER NOT NULL DEFAULT 0, site_id TEXT NOT NULL, visitor_id TEXT NOT NULL, name TEXT, email TEXT, country TEXT, region TEXT, city TEXT, last_seen TEXT NOT NULL DEFAULT (datetime('now')));
	`);
}

const at = (minutesAgo: number): string => new Date(Date.now() - minutesAgo * 60_000).toISOString();

function seedSite(db: Database): void {
	db.prepare("INSERT INTO sites (id, user_id, name, domain) VALUES (?,?,?,?)").run(
		"s1",
		"u1",
		"Test",
		"test.example",
	);
}

function addSession(
	db: Database,
	id: string,
	startedMinutesAgo: number,
	events: { type: string; path: string; name?: string }[],
): void {
	db.prepare("INSERT INTO sessions (id, site_id, visitor_id, started_at) VALUES (?,?,?,?)").run(
		id,
		"s1",
		"v1",
		at(startedMinutesAgo),
	);
	const insert =
		"INSERT INTO events (id, site_id, session_id, visitor_id, timestamp, event_type, name, path) VALUES (?,?,?,?,?,?,?,?)";
	for (const [i, event] of events.entries()) {
		db.prepare(insert).run(
			`${id}-e${i}`,
			"s1",
			id,
			"v1",
			at(startedMinutesAgo - i),
			event.type,
			event.name ?? null,
			event.path,
		);
	}
}

function ctx(db: Database) {
	return {
		db: createDb(makeD1(db) as unknown as D1Database),
		userId: "u1",
		tokenScopes: ["analytics:read"],
		tokenSiteId: "s1",
		tokenType: "site" as const,
	};
}

function pathsOf(journeys: PublicJourney[]): string[][] {
	return journeys.map((j) =>
		j.steps.filter((s) => s.event_type === "pageview").map((s) => s.path as string),
	);
}

describe("queryJourneys path filter", () => {
	it("filters to sessions with a pageview under the prefix, slash-safe", async () => {
		const db = new Database(":memory:");
		createTables(db);
		seedSite(db);
		// newest → oldest: se, sd, sc, sb, sa
		addSession(db, "sa", 50, [
			{ type: "pageview", path: "/voltrus-mes/" },
			{ type: "custom", name: "scroll", path: "/voltrus-mes/" },
		]);
		addSession(db, "sb", 40, [{ type: "pageview", path: "/" }]);
		addSession(db, "sc", 30, [
			{ type: "pageview", path: "/voltrus-mes/blog/oee" },
			{ type: "pageview", path: "/" },
		]);
		// custom-only traffic on the path must not match — pageviews only.
		addSession(db, "sd", 20, [{ type: "custom", name: "heartbeat", path: "/voltrus-mes/" }]);
		// sibling prefix must not match "/voltrus-mes".
		addSession(db, "se", 10, [{ type: "pageview", path: "/voltrus-mesother" }]);

		const unfiltered = await queryJourneys(ctx(db), "s1", "30d", 100);
		expect(unfiltered.length).toBe(5);

		const section = await queryJourneys(ctx(db), "s1", "30d", 100, "/voltrus-mes");
		expect(section.map((j) => j.session_id)).toEqual(["sc", "sa"]);
		expect(pathsOf(section)).toEqual([["/voltrus-mes/blog/oee", "/"], ["/voltrus-mes/"]]);

		const blog = await queryJourneys(ctx(db), "s1", "30d", 100, "/voltrus-mes/blog");
		expect(blog.map((j) => j.session_id)).toEqual(["sc"]);

		const trailing = await queryJourneys(ctx(db), "s1", "30d", 100, "/voltrus-mes/");
		expect(trailing.map((j) => j.session_id)).toEqual(["sc", "sa"]);

		const sibling = await queryJourneys(ctx(db), "s1", "30d", 100, "/voltrus-mesother");
		// exact match on the literal page is correct; only the /voltrus-mes
		// filter above must not swallow /voltrus-mesother.
		expect(sibling.map((j) => j.session_id)).toEqual(["se"]);
		const nomatch = await queryJourneys(ctx(db), "s1", "30d", 100, "/voltrus-mesxyz");
		expect(nomatch.length).toBe(0);
	});

	it("keeps limit behavior on the filtered set", async () => {
		const db = new Database(":memory:");
		createTables(db);
		seedSite(db);
		addSession(db, "sa", 50, [{ type: "pageview", path: "/voltrus-mes/" }]);
		addSession(db, "sb", 40, [{ type: "pageview", path: "/" }]);
		addSession(db, "sc", 30, [{ type: "pageview", path: "/voltrus-mes/pricing" }]);

		const limited = await queryJourneys(ctx(db), "s1", "30d", 2, "/voltrus-mes");
		expect(limited.map((j) => j.session_id)).toEqual(["sc", "sa"]);
	});
});
