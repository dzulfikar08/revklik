import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { createDb } from "../db";
import {
	aggregateData,
	formatMoney,
	generateFallbackInsights,
	type AggregatedData,
} from "./ai-prompts";
import { usdRates } from "./fx";
import { makeD1 } from "./test-harness";

const IDR = { currency: "IDR", rates: usdRates() };

function seed(db: Database): void {
	db.exec(`
		CREATE TABLE sessions (id TEXT PRIMARY KEY, is_bot INTEGER NOT NULL DEFAULT 0, active_seconds INTEGER, site_id TEXT NOT NULL, visitor_id TEXT NOT NULL, started_at TEXT NOT NULL, page_count INTEGER NOT NULL DEFAULT 1);
		CREATE TABLE events (id TEXT PRIMARY KEY, is_bot INTEGER NOT NULL DEFAULT 0, site_id TEXT NOT NULL, visitor_id TEXT NOT NULL, timestamp TEXT NOT NULL, event_type TEXT NOT NULL DEFAULT 'pageview', name TEXT, path TEXT NOT NULL DEFAULT '/', props TEXT, country TEXT, utm_source TEXT, revenue REAL, currency TEXT);
	`);
	const now = new Date().toISOString();
	const insert = db.prepare(
		"INSERT INTO events (id, site_id, visitor_id, timestamp, event_type, country, revenue, currency) VALUES (?,?,?,?,?,?,?,?)",
	);
	// 10 USD + 64.000 IDR, both from Indonesia; the USD sale converts at 16.000.
	insert.run("e1", "s1", "v1", now, "conversion", "ID", 10, "USD");
	insert.run("e2", "s1", "v2", now, "conversion", "ID", 64_000, "IDR");
	insert.run("e3", "s1", "v3", now, "pageview", "SG", null, null);
}

const baseData = (over: Partial<AggregatedData>): AggregatedData => ({
	currency: "USD",
	funnelDropoff: [],
	revenueByCountry: [],
	revenueBySource: [],
	scrollVsConversion: [],
	sessionDistribution: [],
	topPagesByConversion: [],
	totalEvents: 0,
	totalRevenue: 0,
	...over,
});

describe("formatMoney", () => {
	it("formats IDR with id-ID grouping and no decimals", () => {
		expect(formatMoney(5_504_000, "IDR")).toBe("Rp 5.504.000");
		expect(formatMoney(64_000.4, "idr")).toBe("Rp 64.000");
	});

	it("formats USD in whole dollars and falls back to USD for bad codes", () => {
		expect(formatMoney(232, "USD")).toBe("$232");
		expect(formatMoney(1234.6, "USD")).toBe("$1,235");
		expect(formatMoney(5, "NOT-A-CODE")).toBe("$5");
	});
});

describe("aggregateData", () => {
	it("converts revenue into the site currency", async () => {
		const raw = new Database(":memory:");
		seed(raw);
		const db = createDb(makeD1(raw) as unknown as D1Database);

		const data = await aggregateData(
			db,
			"s1",
			new Date(Date.now() - 86_400_000).toISOString(),
			IDR,
		);

		expect(data.currency).toBe("IDR");
		expect(data.totalRevenue).toBe(224_000);
		expect(data.revenueByCountry).toEqual([{ country: "ID", revenue: 224_000, visitors: 2 }]);
		expect(data.totalEvents).toBe(3);
	});

	it("defaults to USD", async () => {
		const raw = new Database(":memory:");
		seed(raw);
		const db = createDb(makeD1(raw) as unknown as D1Database);

		const data = await aggregateData(db, "s1", new Date(Date.now() - 86_400_000).toISOString());

		expect(data.currency).toBe("USD");
		expect(data.totalRevenue).toBe(14);
	});
});

describe("generateFallbackInsights", () => {
	it("writes amounts in the site currency, never a dollar sign for IDR", () => {
		const insights = generateFallbackInsights(
			baseData({
				currency: "IDR",
				revenueByCountry: [
					{ country: "ID", revenue: 3_648_000, visitors: 28 },
					{ country: "GB", revenue: 640_000, visitors: 4 },
				],
				revenueBySource: [{ revenue: 5_504_000, utm_source: "direct", visitors: 42 }],
				totalRevenue: 5_504_000,
			}),
		);

		const text = insights.map((i) => `${i.summary} ${i.detail}`).join(" ");
		expect(text).toContain("Rp 5.504.000");
		expect(text).toContain("Rp 3.648.000");
		expect(text).not.toContain("$");
	});

	it("keeps USD sites in dollars", () => {
		const [insight] = generateFallbackInsights(
			baseData({ revenueBySource: [{ revenue: 360, utm_source: "direct", visitors: 42 }] }),
		);

		expect(insight?.summary).toContain("$360");
		expect(insight?.summary).not.toContain("$360.00");
	});
});
