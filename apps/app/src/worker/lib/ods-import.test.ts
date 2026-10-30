import { describe, expect, it } from "bun:test";
import { ANALYTICS_REPAIRS } from "./analytics-repair";
import { odsDay, odsEventTimestamp } from "./ods-import";
import { createMigratedTestApp } from "./test-harness";

describe("OneDollarStats import dates", () => {
	it("reads the day out of both shapes the API returns", () => {
		expect(odsDay("2026-04-30 00:00:00")).toBe("2026-04-30");
		expect(odsDay("2026-04-30T00:00:00Z")).toBe("2026-04-30");
		expect(odsDay("2026-04-30")).toBe("2026-04-30");
		expect(odsDay("2026-02-31")).toBeNull();
		expect(odsDay("garbage")).toBeNull();
		expect(odsDay(undefined)).toBeNull();
	});

	it("builds timestamps SQLite can bucket", async () => {
		const t = await createMigratedTestApp();
		const ts = odsEventTimestamp(odsDay("2026-04-30 00:00:00") ?? "", 3);
		expect(ts).toBe("2026-04-30T15:00:00.000Z");
		const row = t.db.query("SELECT date(?) AS d").get(ts) as { d: string | null };
		expect(row.d).toBe("2026-04-30");
	});
});

describe("analytics repairs", () => {
	const names = ANALYTICS_REPAIRS.map((r) => r.name);

	it("fixes only the malformed OneDollarStats rows, and only once", async () => {
		const t = await createMigratedTestApp();
		const insert = t.db.prepare(
			"INSERT INTO events (id, site_id, session_id, visitor_id, timestamp, event_type, path, props) VALUES (?,?,?,?,?,?,?,?)",
		);
		const ods = JSON.stringify({ source: "onedollarstats_import" });
		insert.run("bad", "s", "x", "ods_1", "2026-04-30 00:00:00T12:00:00Z", "pageview", "/", ods);
		insert.run("fine", "s", "x", "v", "2026-04-30T12:00:00.000Z", "pageview", "/", null);
		// Same shape but not an import: left alone.
		insert.run("other", "s", "x", "v", "2026-04-30 00:00:00T12:00:00Z", "pageview", "/", "{}");

		const repair = ANALYTICS_REPAIRS.find((r) => r.name === "ods-timestamps");
		if (!repair) throw new Error("repair missing");
		const count = () =>
			(
				t.db.query(`SELECT COUNT(*) AS n FROM ${repair.table} WHERE ${repair.where}`).get() as {
					n: number;
				}
			).n;
		expect(count()).toBe(1);
		t.db.exec(repair.update);
		expect(count()).toBe(0);
		t.db.exec(repair.update);

		const rows = t.db.query("SELECT id, timestamp FROM events ORDER BY id").all();
		expect(rows).toEqual([
			{ id: "bad", timestamp: "2026-04-30T12:00:00Z" },
			{ id: "fine", timestamp: "2026-04-30T12:00:00.000Z" },
			{ id: "other", timestamp: "2026-04-30 00:00:00T12:00:00Z" },
		]);
	});

	it("lowers inflated total_sessions to the real session count and never raises it", async () => {
		const t = await createMigratedTestApp();
		const profile = t.db.prepare(
			"INSERT INTO visitor_profiles (id, site_id, visitor_id, total_sessions) VALUES (?,?,?,?)",
		);
		profile.run("p1", "s", "inflated", 9);
		profile.run("p2", "s", "exact", 1);
		profile.run("p3", "s", "purged", 0);
		const session = t.db.prepare(
			"INSERT INTO sessions (id, site_id, visitor_id, started_at) VALUES (?,?,?,?)",
		);
		session.run("s1", "s", "inflated", "2026-10-01T00:00:00.000Z");
		session.run("s2", "s", "inflated", "2026-10-02T00:00:00.000Z");
		session.run("s3", "s", "exact", "2026-10-02T00:00:00.000Z");

		const repair = ANALYTICS_REPAIRS.find((r) => r.name === "total-sessions");
		if (!repair) throw new Error("repair missing");
		t.db.exec(repair.update);

		const rows = t.db
			.query("SELECT visitor_id, total_sessions FROM visitor_profiles ORDER BY visitor_id")
			.all();
		expect(rows).toEqual([
			{ visitor_id: "exact", total_sessions: 1 },
			{ visitor_id: "inflated", total_sessions: 2 },
			{ visitor_id: "purged", total_sessions: 0 },
		]);
		expect(names).toEqual(["ods-timestamps", "total-sessions"]);
	});
});
