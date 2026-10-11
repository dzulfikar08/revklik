import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
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
});
