import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { sql } from "kysely";
import { createDb } from "../db";
import { migrateDatabase } from "../migrations";
import { makeD1 } from "./test-harness";

async function setup() {
	const db = new Database(":memory:");
	const d1 = makeD1(db) as unknown as D1Database;
	await migrateDatabase(d1);
	return { db, kysely: createDb(d1) };
}

const base = (id: string) => ({
	id,
	site_id: "s1",
	session_id: `ses-${id}`,
	visitor_id: "v1",
	path: "/",
	timestamp: "2026-01-01T00:00:00.000Z",
});

describe("SourceStampPlugin", () => {
	it("stamps events and sessions from their own referrer, utm_source and browser", async () => {
		const { db, kysely } = await setup();
		await kysely
			.insertInto("events")
			.values({
				...base("e1"),
				event_type: "pageview",
				referrer: "https://www.google.co.id/search",
				utm_source: null,
				browser: "Chrome",
			})
			.execute();
		await kysely
			.insertInto("events")
			.values({
				...base("e2"),
				event_type: "pageview",
				referrer: null,
				utm_source: "FB ",
				browser: null,
			})
			.execute();
		await kysely
			.insertInto("events")
			.values({ ...base("e3"), event_type: "conversion", browser: "WhatsApp" })
			.execute();
		await kysely
			.insertInto("sessions")
			.values({
				id: "ses-e1",
				site_id: "s1",
				visitor_id: "v1",
				started_at: new Date().toISOString(),
				referrer: "https://t.co/x",
				utm_source: null,
				page_count: 1,
				is_bounce: 1,
			})
			.execute();

		const events = db.query("SELECT id, source FROM events ORDER BY id").all();
		expect(events).toEqual([
			{ id: "e1", source: "google.com" },
			{ id: "e2", source: "facebook" },
			{ id: "e3", source: "whatsapp" },
		]);
		expect(db.query("SELECT source FROM sessions").all()).toEqual([{ source: "twitter" }]);
	});

	it("stamps every row of a multi-row insert and respects an explicit source", async () => {
		const { db, kysely } = await setup();
		await kysely
			.insertInto("events")
			.values([
				{ ...base("a"), event_type: "pageview", referrer: "https://bing.com/" },
				{ ...base("b"), event_type: "pageview", utm_source: "ddg" },
			])
			.execute();
		await kysely
			.insertInto("events")
			.values({ ...base("c"), event_type: "pageview", referrer: "https://bing.com/", source: "x" })
			.execute();
		expect(db.query("SELECT id, source FROM events ORDER BY id").all()).toEqual([
			{ id: "a", source: "bing.com" },
			{ id: "b", source: "duckduckgo.com" },
			{ id: "c", source: "x" },
		]);
	});

	it("leaves other tables and expression-valued inputs unstamped", async () => {
		const { db, kysely } = await setup();
		await kysely
			.insertInto("events")
			.values({
				...base("d"),
				event_type: "pageview",
				referrer: sql<string>`'https://bing.com/'`,
			})
			.execute();
		expect(db.query("SELECT source FROM events WHERE id = 'd'").get()).toEqual({ source: null });
	});
});
