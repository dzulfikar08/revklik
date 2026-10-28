import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { createDb } from "../db";
import { makeD1 } from "../lib/test-harness";
import { getRevenueByPaymentMethod, getRevenueByPaymentProvider } from "./analytics";

function seed(): Database {
	const db = new Database(":memory:");
	db.exec(
		`CREATE TABLE events (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, session_id TEXT NOT NULL, visitor_id TEXT NOT NULL, timestamp TEXT NOT NULL, event_type TEXT NOT NULL DEFAULT 'pageview', name TEXT, path TEXT NOT NULL DEFAULT '/', hostname TEXT, referrer TEXT, utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, utm_term TEXT, utm_content TEXT, country TEXT, region TEXT, city TEXT, device_type TEXT, browser TEXT, os TEXT, revenue REAL, currency TEXT, props TEXT, payment_provider TEXT, payment_method TEXT, is_bot INTEGER NOT NULL DEFAULT 0, source TEXT)`,
	);
	const ins = db.prepare(
		"INSERT INTO events (id, site_id, session_id, visitor_id, timestamp, event_type, revenue, currency, payment_provider, payment_method) VALUES (?,?,?,?,?,?,?,?,?,?)",
	);
	const ts = "2026-10-28T05:00:00.000Z";
	ins.run("1", "s1", "a", "v", ts, "purchase", 100_000, "IDR", "midtrans", "qris");
	ins.run("2", "s1", "b", "v", ts, "purchase", 50_000, "IDR", "xendit", "qris");
	ins.run("3", "s1", "c", "v", ts, "purchase", 10, "USD", "stripe", "card");
	ins.run("4", "s1", "d", "v", ts, "purchase", 5_000, "IDR", null, null);
	ins.run("5", "s1", "e", "v", ts, "pageview", 0, null, "midtrans", "qris");
	return db;
}

describe("payment breakdown queries", () => {
	const scope = { money: { currency: "IDR", rates: { USD: 1, IDR: 16_000 } }, tzOffset: 0 };
	const start = "2026-10-01T00:00:00.000Z";

	it("groups revenue by method in the display currency", async () => {
		const db = createDb(makeD1(seed()) as never);
		const rows = await getRevenueByPaymentMethod(db, "s1", start, undefined, undefined, scope);
		expect(rows).toEqual([
			{ method: "card", count: 1, revenue: 160_000 },
			{ method: "qris", count: 2, revenue: 150_000 },
			{ method: "unknown", count: 1, revenue: 5_000 },
		]);
	});

	it("groups revenue by provider and ignores zero-revenue events", async () => {
		const db = createDb(makeD1(seed()) as never);
		const rows = await getRevenueByPaymentProvider(db, "s1", start, undefined, undefined, scope);
		expect(rows.map((r) => r.provider)).toEqual(["stripe", "midtrans", "xendit", "unknown"]);
		expect(rows.reduce((a, r) => a + r.revenue, 0)).toBe(315_000);
	});
});
