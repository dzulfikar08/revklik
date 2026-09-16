import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { createApp } from "../app";
import { makeD1, type D1Like } from "../lib/test-harness";

/**
 * Route test for the datacenter exclusion in POST /track.
 *
 * The UA bot branch is covered by utils.test.ts; this covers the case it cannot
 * see: a real browser user agent arriving from a hosting-network ASN. The
 * request must leave `events` untouched and land in `crawler_hits` instead, so
 * datacenter traffic never inflates human analytics.
 *
 * Tables are created directly because the migrations module has a process-wide
 * "already ran" guard (same reason as routes/public-live.test.ts).
 */
function createTables(db: Database): void {
	db.exec(`
		CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, name TEXT NOT NULL, google_id TEXT, avatar_url TEXT, role TEXT NOT NULL DEFAULT 'user', created_at TEXT NOT NULL DEFAULT (datetime('now')));
		CREATE TABLE IF NOT EXISTS subscriptions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, plan TEXT NOT NULL DEFAULT 'free', status TEXT NOT NULL DEFAULT 'active', current_period_end TEXT, pakasir_order_id TEXT);
		CREATE TABLE IF NOT EXISTS sites (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, domain TEXT NOT NULL, excluded_fingerprints TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
		CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, session_id TEXT NOT NULL, visitor_id TEXT NOT NULL, timestamp TEXT NOT NULL DEFAULT (datetime('now')), event_type TEXT NOT NULL DEFAULT 'pageview', name TEXT, path TEXT NOT NULL, hostname TEXT, referrer TEXT, utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, utm_term TEXT, utm_content TEXT, country TEXT, region TEXT, city TEXT, device_type TEXT, browser TEXT, os TEXT, revenue REAL, props TEXT, fingerprint TEXT, payment_provider TEXT, payment_method TEXT, currency TEXT DEFAULT 'USD', subscription_id TEXT);
		CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, visitor_id TEXT NOT NULL, started_at TEXT NOT NULL DEFAULT (datetime('now')), ended_at TEXT, entry_path TEXT, exit_path TEXT, referrer TEXT, utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, country TEXT, region TEXT, city TEXT, device_type TEXT, browser TEXT, os TEXT, page_count INTEGER NOT NULL DEFAULT 1, is_bounce INTEGER NOT NULL DEFAULT 1, fingerprint TEXT);
		CREATE TABLE IF NOT EXISTS visitor_profiles (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, visitor_id TEXT NOT NULL, name TEXT, email TEXT, phone TEXT, avatar TEXT, first_seen TEXT NOT NULL DEFAULT (datetime('now')), last_seen TEXT NOT NULL DEFAULT (datetime('now')), country TEXT, region TEXT, city TEXT, device_type TEXT, browser TEXT, os TEXT, total_sessions INTEGER NOT NULL DEFAULT 0, total_pageviews INTEGER NOT NULL DEFAULT 0, total_revenue REAL NOT NULL DEFAULT 0, tags TEXT, notes TEXT, fingerprint TEXT);
		CREATE TABLE IF NOT EXISTS crawler_hits (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, bot TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'other', path TEXT, user_agent TEXT, country TEXT, timestamp TEXT NOT NULL DEFAULT (datetime('now')));
		CREATE UNIQUE INDEX IF NOT EXISTS idx_vp_site_visitor ON visitor_profiles(site_id, visitor_id);
	`);
	db.prepare("INSERT INTO sites (id, user_id, name, domain) VALUES (?,?,?,?)").run(
		"s1",
		"u1",
		"Site",
		"example.com",
	);
}

/** A real browser user agent, the shape that bypasses the UA marker list. */
const CHROME_UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const PAGEVIEW = {
	s: "s1",
	sid: "ses-1",
	vid: "visitor-1",
	t: "p",
	p: "/modbus-poll/",
	h: "example.com",
	ts: Date.now(),
};

interface Env {
	DB: D1Like;
	ASSETS: { fetch: (req: Request) => Promise<Response> };
}

/** Request carrying a Cloudflare `cf` object, which the Worker runtime attaches. */
function requestWithCf(cf: Record<string, unknown> | undefined, body: unknown): Request {
	const req = new Request("https://example.com/api/track", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"user-agent": CHROME_UA,
			"cf-connecting-ip": "203.0.113.7",
		},
		body: JSON.stringify(body),
	});
	Object.defineProperty(req, "cf", { value: cf, enumerable: true });
	return req;
}

async function track(
	db: Database,
	cf: Record<string, unknown> | undefined,
): Promise<{ status: number; body: { excluded?: boolean; reason?: string } }> {
	const env: Env = {
		DB: makeD1(db),
		ASSETS: { fetch: async () => new Response("nf", { status: 404 }) },
	};
	const pending: Promise<unknown>[] = [];
	const ctx = {
		waitUntil: (p: Promise<unknown>) => {
			pending.push(p);
		},
		passThroughOnException: () => {},
	};
	const app = createApp();
	const res = await app.fetch(requestWithCf(cf, PAGEVIEW), env as never, ctx as never);
	const body = (await res.json()) as { excluded?: boolean; reason?: string };
	// The crawler_hits write is fire-and-forget; settle it before asserting.
	await Promise.all(pending);
	return { status: res.status, body };
}

describe("POST /track datacenter exclusion", () => {
	it("drops a browser-shaped pageview from a hosting ASN into crawler_hits", async () => {
		const db = new Database(":memory:");
		createTables(db);
		const { status, body } = await track(db, {
			country: "SG",
			city: "Singapore",
			asOrganization: "DIGITALOCEAN-ASN",
		});

		expect(status).toBe(202);
		expect(body.excluded).toBe(true);
		expect(db.prepare("SELECT COUNT(*) AS n FROM events").get()).toEqual({ n: 0 });

		const hits = db
			.prepare("SELECT bot, category, path, country FROM crawler_hits")
			.all() as Array<{ bot: string; category: string; path: string; country: string }>;
		expect(hits).toEqual([
			{
				bot: "datacenter:DIGITALOCEAN-ASN",
				category: "other",
				path: "/modbus-poll/",
				country: "SG",
			},
		]);
	});

	it("does not classify a consumer ISP pageview as bot traffic", async () => {
		const db = new Database(":memory:");
		createTables(db);
		const { status, body } = await track(db, {
			country: "ID",
			city: "Surabaya",
			asOrganization: "TELKOMNET-AS-AP PT Telkom Indonesia",
		});

		// Not the bot branch: the request continues into the normal ingest path,
		// so the pageview is recorded for a human visitor.
		expect(body.excluded).toBeUndefined();
		expect(status).toBe(202);
		const hits = db.prepare("SELECT COUNT(*) AS n FROM crawler_hits").get() as { n: number };
		expect(hits.n).toBe(0);
		const events = db.prepare("SELECT path, country, visitor_id FROM events").all() as Array<{
			path: string;
			country: string;
			visitor_id: string;
		}>;
		expect(events).toEqual([{ path: "/modbus-poll/", country: "ID", visitor_id: "visitor-1" }]);
	});

	it("treats a missing cf object as unknown and does not classify", async () => {
		const db = new Database(":memory:");
		createTables(db);
		const { body } = await track(db, undefined);
		expect(body.excluded).toBeUndefined();
		const hits = db.prepare("SELECT COUNT(*) AS n FROM crawler_hits").get() as { n: number };
		expect(hits.n).toBe(0);
	});
});
