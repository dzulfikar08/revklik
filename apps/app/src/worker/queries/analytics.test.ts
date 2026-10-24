import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { createDb } from "../db";
import { makeD1, type D1Like } from "../lib/test-harness";
import { getLatestSessionsForVisitors } from "./analytics";

/**
 * Query-level tests for the dashboard's visitor backfill. D1 caps a single
 * statement at 100 bound parameters ("too many SQL variables"); bun:sqlite does
 * not enforce it, so the shim is wrapped to reproduce D1's hard failure.
 */
function capBoundParams(d1: D1Like, max = 100): D1Like {
	return {
		...d1,
		prepare(sql: string) {
			const variables = sql.split("?").length - 1;
			if (variables > max) {
				throw new Error(`D1_ERROR: too many SQL variables at offset ${variables}: SQLITE_ERROR`);
			}
			return d1.prepare(sql);
		},
	};
}

function createTables(db: Database): void {
	db.exec(`
		CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, is_bot INTEGER NOT NULL DEFAULT 0, active_seconds INTEGER, site_id TEXT NOT NULL, visitor_id TEXT NOT NULL, started_at TEXT NOT NULL DEFAULT (datetime('now')), ended_at TEXT, entry_path TEXT, exit_path TEXT, referrer TEXT, utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, country TEXT, region TEXT, city TEXT, device_type TEXT, browser TEXT, os TEXT, page_count INTEGER NOT NULL DEFAULT 1, is_bounce INTEGER NOT NULL DEFAULT 1);
		CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, is_bot INTEGER NOT NULL DEFAULT 0, site_id TEXT NOT NULL, session_id TEXT NOT NULL, visitor_id TEXT NOT NULL, timestamp TEXT NOT NULL DEFAULT (datetime('now')), event_type TEXT NOT NULL DEFAULT 'pageview', name TEXT, path TEXT NOT NULL);
	`);
}

const at = (minutesAgo: number): string => new Date(Date.now() - minutesAgo * 60_000).toISOString();

function addSession(
	db: Database,
	id: string,
	visitorId: string,
	startedAt: string,
	events: { type: string; name: string | null }[],
): void {
	db.prepare("INSERT INTO sessions (id, site_id, visitor_id, started_at) VALUES (?,?,?,?)").run(
		id,
		"s1",
		visitorId,
		startedAt,
	);
	const insert =
		"INSERT INTO events (id, site_id, session_id, visitor_id, timestamp, event_type, name, path) VALUES (?,?,?,?,?,?,?,?)";
	for (const [i, event] of events.entries()) {
		db.prepare(insert).run(
			`${id}-e${i}`,
			"s1",
			id,
			visitorId,
			startedAt,
			event.type,
			event.name,
			"/",
		);
	}
}

describe("getLatestSessionsForVisitors", () => {
	// visitor_profiles scale to 100, so the id list alone can push the statement
	// past D1's bound-parameter cap once the scope/exists binds are counted.
	it("loads every visitor's session when the id list exceeds the cap", async () => {
		const db = new Database(":memory:");
		createTables(db);
		const sql = createDb(capBoundParams(makeD1(db)) as unknown as D1Database);

		const ids = Array.from({ length: 100 }, (_, i) => `v${i}`);
		for (const [i, id] of ids.entries()) {
			addSession(db, `sess-${id}`, id, at(60 + i), [{ type: "pageview", name: null }]);
		}

		const sessions = await getLatestSessionsForVisitors(sql, "s1", ids);

		expect(sessions).toHaveLength(100);
		expect(new Set(sessions.map((s) => s.visitor_id))).toEqual(new Set(ids));
	});

	it("keeps only the newest event-bearing session per visitor, newest first", async () => {
		const db = new Database(":memory:");
		createTables(db);
		const sql = createDb(capBoundParams(makeD1(db)) as unknown as D1Database);

		addSession(db, "a-old", "a", at(180), [{ type: "pageview", name: null }]);
		addSession(db, "a-new", "a", at(30), [{ type: "pageview", name: null }]);
		// Custom/heartbeat-only sessions are tracking noise, not journeys.
		addSession(db, "b-noise", "b", at(60), [{ type: "custom", name: "heartbeat" }]);
		addSession(db, "c-custom", "c", at(60), [{ type: "custom", name: "signup" }]);

		const sessions = await getLatestSessionsForVisitors(sql, "s1", ["a", "b", "c"]);

		expect(sessions.map((s) => s.id)).toEqual(["a-new", "c-custom"]);
	});
});
