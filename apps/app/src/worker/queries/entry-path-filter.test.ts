import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { createDb } from "../db";
import { makeD1 } from "../lib/test-harness";
import { parseFilters } from "../lib/analytics-queries";
import {
	getEntryPagesRevenue,
	getRevenueBySource,
	getRevenueTimeseries,
	getTopPages,
} from "./analytics";

const EVENT_COLUMNS =
	"id TEXT PRIMARY KEY, site_id TEXT NOT NULL, session_id TEXT NOT NULL, visitor_id TEXT NOT NULL, timestamp TEXT NOT NULL, event_type TEXT NOT NULL DEFAULT 'pageview', name TEXT, path TEXT NOT NULL DEFAULT '/', hostname TEXT, referrer TEXT, utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, utm_term TEXT, utm_content TEXT, country TEXT, region TEXT, city TEXT, device_type TEXT, browser TEXT, os TEXT, revenue REAL, currency TEXT, props TEXT, payment_provider TEXT, payment_method TEXT, is_bot INTEGER NOT NULL DEFAULT 0, source TEXT, excluded_reason TEXT, fx_rate REAL, fx_date TEXT, fx_status TEXT";
const SESSION_COLUMNS =
	"id TEXT PRIMARY KEY, site_id TEXT NOT NULL, visitor_id TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT, entry_path TEXT, exit_path TEXT, referrer TEXT, utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, country TEXT, region TEXT, city TEXT, device_type TEXT, browser TEXT, os TEXT, page_count INTEGER NOT NULL DEFAULT 1, is_bounce INTEGER NOT NULL DEFAULT 0, fingerprint TEXT, is_bot INTEGER NOT NULL DEFAULT 0, bot_reason TEXT, active_seconds INTEGER, as_org TEXT, source TEXT";

const TS = "2026-10-28T05:00:00.000Z";

/**
 * Two buyers land on /pricing and one on /blog; every sale is booked on /checkout,
 * so a plain `path` filter can never see a sale.
 */
function seed(): Database {
	const db = new Database(":memory:");
	db.exec(`CREATE TABLE events (${EVENT_COLUMNS})`);
	db.exec(`CREATE TABLE sessions (${SESSION_COLUMNS})`);
	const session = db.prepare(
		"INSERT INTO sessions (id, site_id, visitor_id, started_at, entry_path, source) VALUES (?,?,?,?,?,?)",
	);
	const event = db.prepare(
		"INSERT INTO events (id, site_id, session_id, visitor_id, timestamp, event_type, path, revenue, currency, source) VALUES (?,?,?,?,?,?,?,?,?,?)",
	);
	session.run("a", "s1", "va", TS, "/pricing", "Google");
	session.run("b", "s1", "vb", TS, "/pricing", "Google");
	session.run("c", "s1", "vc", TS, "/blog", "Direct");
	event.run("e1", "s1", "a", "va", TS, "pageview", "/pricing", null, null, "Google");
	event.run("e2", "s1", "a", "va", TS, "conversion", "/checkout", 100_000, "IDR", "Google");
	event.run("e3", "s1", "b", "vb", TS, "pageview", "/pricing", null, null, "Google");
	event.run("e4", "s1", "b", "vb", TS, "conversion", "/checkout", 50_000, "IDR", "Google");
	event.run("e5", "s1", "c", "vc", TS, "pageview", "/blog", null, null, "Direct");
	event.run("e6", "s1", "c", "vc", TS, "conversion", "/checkout", 20_000, "IDR", "Direct");
	return db;
}

const scope = { money: { currency: "IDR", rates: { USD: 1, IDR: 16_000 } }, tzOffset: 0 };
const start = "2026-10-01T00:00:00.000Z";
const open = () => createDb(makeD1(seed()) as never);

describe("entry_path filter", () => {
	it("is accepted by the filter parser", () => {
		expect(parseFilters("entry_path:is:/pricing")).toEqual([
			{ dimension: "entry_path", operator: "is", value: "/pricing" },
		]);
	});

	it("What sells rows keep their sales when filtered to their own entry page", async () => {
		const filters = parseFilters("entry_path:is:/pricing");
		const rows = await getEntryPagesRevenue(open(), "s1", start, filters, undefined, scope);
		expect(rows).toEqual([{ path: "/pricing", sessions: 2, conversions: 2, revenue: 150_000 }]);
	});

	it("the event `path` filter is why those rows showed 0 sales", async () => {
		const filters = parseFilters("path:is:/pricing");
		const rows = await getEntryPagesRevenue(open(), "s1", start, filters, undefined, scope);
		expect(rows.reduce((sum, r) => sum + r.revenue, 0)).toBe(0);
	});

	it("attributes event-table revenue to the session's entry page", async () => {
		const filters = parseFilters("entry_path:is:/blog");
		const bySource = await getRevenueBySource(open(), "s1", start, filters, undefined, scope);
		expect(bySource.map((r) => [r.source, r.revenue])).toEqual([["Direct", 20_000]]);
		const series = await getRevenueTimeseries(
			open(),
			"s1",
			start,
			false,
			filters,
			undefined,
			scope,
		);
		expect(series.reduce((sum, p) => sum + p.revenue, 0)).toBe(20_000);
	});

	it("narrows page views to sessions that entered on the page", async () => {
		const filters = parseFilters("entry_path:is:/pricing");
		const pages = await getTopPages(open(), "s1", start, 10, filters);
		expect(pages.map((p) => [p.path, p.pageviews])).toEqual([["/pricing", 2]]);
	});

	it("supports the other operators", async () => {
		const rows = await getEntryPagesRevenue(
			open(),
			"s1",
			start,
			parseFilters("entry_path:is_not:/pricing"),
			undefined,
			scope,
		);
		expect(rows.map((r) => r.path)).toEqual(["/blog"]);
	});
});
