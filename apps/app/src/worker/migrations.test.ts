import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { classifySource } from "./lib/source-sql";
import { makeD1 } from "./lib/test-harness";
import { hasMigrated, migrateDatabase, SCHEMA_VERSION } from "./migrations";

function countingD1(db: Database) {
	const inner = makeD1(db);
	const seen: string[] = [];
	const d1 = {
		...inner,
		prepare(sql: string) {
			seen.push(sql);
			return inner.prepare(sql);
		},
	};
	return { d1: d1 as unknown as D1Database, seen };
}

describe("migrateDatabase", () => {
	it("migrates a fresh DB and records SCHEMA_VERSION", async () => {
		const db = new Database(":memory:");
		const { d1 } = countingD1(db);
		await migrateDatabase(d1);
		const row = db.query("SELECT version FROM schema_version WHERE id = 1").get() as {
			version: number;
		};
		expect(row.version).toBe(SCHEMA_VERSION);
		expect(hasMigrated(d1)).toBe(true);
		expect(db.query("SELECT name FROM sqlite_master WHERE name = 'events'").get()).toBeTruthy();
	});

	it("an up-to-date DB costs a single SELECT and no DDL", async () => {
		const db = new Database(":memory:");
		await migrateDatabase(makeD1(db) as unknown as D1Database);

		const { d1, seen } = countingD1(db);
		await migrateDatabase(d1);
		expect(seen).toEqual(["SELECT version FROM schema_version WHERE id = 1"]);

		// memoized per binding: a second call issues nothing
		await migrateDatabase(d1);
		expect(seen.length).toBe(1);
	});

	it("re-runs steps when the recorded version is behind", async () => {
		const db = new Database(":memory:");
		await migrateDatabase(makeD1(db) as unknown as D1Database);
		db.exec("UPDATE schema_version SET version = 1");

		const { d1, seen } = countingD1(db);
		await migrateDatabase(d1);
		expect(seen.length).toBeGreaterThan(1);
		const row = db.query("SELECT version FROM schema_version").get() as { version: number };
		expect(row.version).toBe(SCHEMA_VERSION);
	});

	it("v17 backfills events.source and sessions.source in chunks matching classifySource", async () => {
		const db = new Database(":memory:");
		await migrateDatabase(makeD1(db) as unknown as D1Database);

		const referrers = [null, "https://www.google.co.id/", "https://t.co/x", "https://bing.com/q"];
		db.transaction(() => {
			const insertEvent = db.prepare(
				"INSERT INTO events (id, site_id, session_id, visitor_id, path, referrer, utm_source, browser) VALUES (?, 's', 'x', 'v', '/', ?, ?, ?)",
			);
			for (let i = 0; i < 4500; i++) {
				insertEvent.run(
					`e${i}`,
					referrers[i % referrers.length] ?? null,
					i % 7 === 0 ? " Newsletter" : null,
					i % 11 === 0 ? "WhatsApp" : "Chrome",
				);
			}
			const insertSession = db.prepare(
				"INSERT INTO sessions (id, site_id, visitor_id, started_at, referrer) VALUES (?, 's', 'v', '2026-01-01', ?)",
			);
			for (let i = 0; i < 30; i++)
				insertSession.run(`s${i}`, referrers[i % referrers.length] ?? null);
		})();
		db.exec("UPDATE schema_version SET version = 16");

		const { d1, seen } = countingD1(db);
		await migrateDatabase(d1);

		expect(db.query("SELECT COUNT(*) AS n FROM events WHERE source IS NULL").get()).toEqual({
			n: 0,
		});
		expect(db.query("SELECT COUNT(*) AS n FROM sessions WHERE source IS NULL").get()).toEqual({
			n: 0,
		});
		expect(seen.filter((s) => s.startsWith("UPDATE events SET source")).length).toBe(3);

		const rows = db
			.query("SELECT referrer, utm_source, browser, source FROM events")
			.all() as Array<{
			referrer: string | null;
			utm_source: string | null;
			browser: string | null;
			source: string;
		}>;
		expect(rows.filter((r) => r.source !== classifySource(r))).toEqual([]);
		expect(new Set(rows.map((r) => r.source))).toEqual(
			new Set(["direct", "whatsapp", "newsletter", "google.com", "twitter", "bing.com"]),
		);
	});

	it("v18 flags probe-payload events, their sessions and all-bot visitors only", async () => {
		const db = new Database(":memory:");
		await migrateDatabase(makeD1(db) as unknown as D1Database);
		const ev = db.prepare(
			"INSERT INTO events (id, site_id, session_id, visitor_id, path, referrer, utm_source) VALUES (?, 's', ?, ?, ?, ?, ?)",
		);
		const ses = db.prepare(
			"INSERT INTO sessions (id, site_id, visitor_id, started_at) VALUES (?, 's', ?, '2026-01-01')",
		);
		const vp = db.prepare(
			"INSERT INTO visitor_profiles (site_id, visitor_id, first_seen, last_seen) VALUES ('s', ?, '2026-01-01', '2026-01-01')",
		);
		ev.run("bad1", "sb", "vb", "/", "javascript:domxssexecutionsink(1,'x')", null);
		ev.run("bad2", "sb2", "vm", "/a/../b", null, null);
		ev.run("tail1", "sb", "vb", "/pricing", null, null);
		ev.run("ok1", "sg", "vm", "/", "https://www.google.com/", "spring sale \u{1F680}");
		ev.run("ok2", "sg2", "vg", "/", "https://t.co/abc", null);
		for (const [s, v] of [
			["sb", "vb"],
			["sb2", "vm"],
			["sg", "vm"],
			["sg2", "vg"],
		])
			ses.run(s, v);
		for (const v of ["vb", "vm", "vg"]) vp.run(v);
		db.exec("UPDATE schema_version SET version = 17");

		await migrateDatabase(makeD1(db) as unknown as D1Database);

		const flagged = (sql: string) =>
			(db.query(sql).all() as Array<{ id: string }>).map((r) => r.id);
		expect(flagged("SELECT id FROM events WHERE is_bot = 1 ORDER BY id")).toEqual([
			"bad1",
			"bad2",
			"tail1",
		]);
		expect(flagged("SELECT id FROM sessions WHERE is_bot = 1 ORDER BY id")).toEqual(["sb", "sb2"]);
		expect(flagged("SELECT visitor_id AS id FROM visitor_profiles WHERE is_bot = 1")).toEqual([
			"vb",
		]);
		expect(db.query("SELECT bot_reason FROM sessions WHERE id = 'sb'").get()).toEqual({
			bot_reason: "probe_payload",
		});
	});
});
