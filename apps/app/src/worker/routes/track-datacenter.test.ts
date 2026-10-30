import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { createApp } from "../app";
import { makeD1, type D1Like } from "../lib/test-harness";
import { migrateDatabase } from "../migrations";

/**
 * Route test for the datacenter exclusion in POST /track.
 *
 * The UA bot branch is covered by utils.test.ts; this covers the case it cannot
 * see: a real browser user agent arriving from a hosting-network ASN. The
 * request must leave `events` untouched and land in `crawler_hits` instead, so
 * datacenter traffic never inflates human analytics.
 *
 * The schema comes from the real migrations: a hand-written subset would let the
 * migration runner fail halfway and leave columns the ingest path needs missing.
 */
async function createTables(db: Database): Promise<void> {
	await migrateDatabase(makeD1(db) as unknown as D1Database);
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
		await createTables(db);
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
		await createTables(db);
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
		await createTables(db);
		const { body } = await track(db, undefined);
		expect(body.excluded).toBeUndefined();
		const hits = db.prepare("SELECT COUNT(*) AS n FROM crawler_hits").get() as { n: number };
		expect(hits.n).toBe(0);
	});
});
