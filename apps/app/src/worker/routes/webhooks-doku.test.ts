import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { createApp } from "../app";
import { makeD1 } from "../lib/test-harness";

/**
 * DOKU SNAP payment notification webhook. Signature per developers.doku.com
 * ("HTTP Notification Sample for SNAP"): X-SIGNATURE = HMAC-SHA512(clientSecret,
 * `POST:RELATIVE-URL:ACCESS-TOKEN:HEX(SHA256(requestBody)):TIMESTAMP`). The
 * site resolves from X-PARTNER-ID against the stored client_id — no payload
 * metadata is involved, and the signature is computed here independently of
 * the route's helper so the test can't pass by construction.
 */

const db = new Database(":memory:");
const d1 = makeD1(db);

db.exec(`
	CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, name TEXT NOT NULL, google_id TEXT, avatar_url TEXT, role TEXT NOT NULL DEFAULT 'user', created_at TEXT NOT NULL DEFAULT (datetime('now')));
	CREATE TABLE IF NOT EXISTS sites (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, domain TEXT NOT NULL, share_token TEXT, public_dashboard INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
	CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, session_id TEXT NOT NULL, visitor_id TEXT NOT NULL, timestamp TEXT NOT NULL DEFAULT (datetime('now')), event_type TEXT NOT NULL DEFAULT 'pageview', name TEXT, path TEXT NOT NULL, hostname TEXT, referrer TEXT, utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, utm_term TEXT, utm_content TEXT, country TEXT, region TEXT, city TEXT, device_type TEXT, browser TEXT, os TEXT, revenue REAL, payment_provider TEXT, payment_method TEXT, currency TEXT DEFAULT 'USD', subscription_id TEXT, props TEXT, fingerprint TEXT);
	CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, visitor_id TEXT NOT NULL, started_at TEXT NOT NULL DEFAULT (datetime('now')), ended_at TEXT, entry_path TEXT, exit_path TEXT, referrer TEXT, utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, country TEXT, region TEXT, city TEXT, device_type TEXT, browser TEXT, os TEXT, page_count INTEGER NOT NULL DEFAULT 1, is_bounce INTEGER NOT NULL DEFAULT 1, fingerprint TEXT);
	CREATE TABLE IF NOT EXISTS visitor_profiles (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, visitor_id TEXT NOT NULL, name TEXT, email TEXT, phone TEXT, avatar TEXT, first_seen TEXT NOT NULL DEFAULT (datetime('now')), last_seen TEXT NOT NULL DEFAULT (datetime('now')), country TEXT, region TEXT, city TEXT, device_type TEXT, browser TEXT, os TEXT, fingerprint TEXT, total_sessions INTEGER NOT NULL DEFAULT 0, total_pageviews INTEGER NOT NULL DEFAULT 0, total_revenue REAL NOT NULL DEFAULT 0, tags TEXT, notes TEXT);
	CREATE TABLE IF NOT EXISTS webhook_events (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, integration_id TEXT NOT NULL, direction TEXT NOT NULL, event_type TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), processed_at TEXT);
	CREATE TABLE IF NOT EXISTS payment_providers (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, provider TEXT NOT NULL, config TEXT, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')));
	CREATE UNIQUE INDEX IF NOT EXISTS idx_vp_site_visitor ON visitor_profiles(site_id, visitor_id);
`);

const SITE = "s-doku";
const CLIENT_ID = "BRN-TEST-CLIENT";
const SECRET = "doku-secret-test";
const NOW = new Date().toISOString();

db.prepare("INSERT INTO users (id, email, password_hash, name, created_at) VALUES (?,?,?,?,?)").run(
	"u-doku",
	"doku@example.com",
	"x",
	"DOKU Test",
	NOW,
);
db.prepare("INSERT INTO sites (id, user_id, name, domain, created_at) VALUES (?,?,?,?,?)").run(
	SITE,
	"u-doku",
	"DOKU Site",
	"doku.example.com",
	NOW,
);
db.prepare(
	"INSERT INTO payment_providers (id, site_id, provider, config, enabled, created_at) VALUES (?,?,?,?,1,?)",
).run("pp-doku", SITE, "doku", JSON.stringify({ client_id: CLIENT_ID, secret_key: SECRET }), NOW);

const app = createApp();
const env = { DB: d1, ASSETS: { fetch: async () => new Response("nf", { status: 404 }) } };
const execCtx = {
	waitUntil: () => {},
	passThroughOnException: () => {},
	abort: () => {},
	props: {},
};

const body = JSON.stringify({
	responseCode: "2002500",
	responseMessage: "Success",
	virtualAccountData: {
		partnerServiceId: "  888888",
		customerNo: "9912345678",
		virtualAccountNo: "8888889912345678",
		virtualAccountName: "DOKU Test Buyer",
		trxId: "TRX-DOKU-1",
		amount: { value: "175000.00", currency: "IDR" },
		trxDateTime: NOW,
		paymentFlag: "Y",
	},
});

async function signRequest(
	method: string,
	relativeUrl: string,
	accessToken: string,
	requestBody: string,
	timestamp: string,
): Promise<string> {
	const stringToSign = [
		method,
		relativeUrl,
		accessToken,
		Array.from(
			new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(requestBody))),
			(b) => b.toString(16).padStart(2, "0"),
		).join(""),
		timestamp,
	].join(":");
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(SECRET),
		{ name: "HMAC", hash: "SHA-512" },
		false,
		["sign"],
	);
	const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(stringToSign));
	return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
}

describe("doku webhook", () => {
	it("verifies the SNAP signature, resolves the site via X-PARTNER-ID, and credits revenue", async () => {
		const timestamp = "2026-09-15T13:00:00+07:00";
		const signature = await signRequest(
			"POST",
			"/api/webhooks/doku",
			"access-tok-1",
			body,
			timestamp,
		);
		const res = await app.request(
			"/api/webhooks/doku",
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-partner-id": CLIENT_ID,
					"x-timestamp": timestamp,
					"x-signature": signature,
					authorization: "Bearer access-tok-1",
				},
				body,
			},
			env,
			execCtx,
		);
		expect(res.status).toBe(200);
		const json = (await res.json()) as { success: boolean; amount: number };
		expect(json.success).toBe(true);
		expect(json.amount).toBe(175000);

		const ev = db
			.prepare(
				'SELECT revenue, payment_provider, payment_method, visitor_id FROM events WHERE props LIKE \'%"doku_trx_id":"TRX-DOKU-1"%\'',
			)
			.get() as {
			revenue: number;
			payment_provider: string;
			payment_method: string;
			visitor_id: string;
		};
		expect(ev.revenue).toBe(175000);
		expect(ev.payment_provider).toBe("doku");
		expect(ev.visitor_id).toBe("dku_TRX_DOKU_1");

		const profile = db
			.prepare("SELECT total_revenue FROM visitor_profiles WHERE visitor_id = 'dku_TRX_DOKU_1'")
			.get() as { total_revenue: number };
		expect(profile.total_revenue).toBe(175000);
	});

	it("rejects a tampered body (signature no longer matches)", async () => {
		const timestamp = "2026-09-15T13:05:00+07:00";
		// Signed for the original body, delivered with a modified amount.
		const signature = await signRequest(
			"POST",
			"/api/webhooks/doku",
			"access-tok-2",
			body,
			timestamp,
		);
		const res = await app.request(
			"/api/webhooks/doku",
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-partner-id": CLIENT_ID,
					"x-timestamp": timestamp,
					"x-signature": signature,
					authorization: "Bearer access-tok-2",
				},
				body: body.replace("175000.00", "99000.00"),
			},
			env,
			execCtx,
		);
		expect(res.status).toBe(401);
		const failed = db
			.prepare(
				"SELECT COUNT(*) AS n FROM webhook_events WHERE event_type = 'doku_invalid_signature'",
			)
			.get() as { n: number };
		expect(failed.n).toBe(1);
	});

	it("rejects an unknown client id", async () => {
		const timestamp = "2026-09-15T13:06:00+07:00";
		const res = await app.request(
			"/api/webhooks/doku",
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-partner-id": "unknown-client",
					"x-timestamp": timestamp,
					"x-signature": "aa",
					authorization: "Bearer t",
				},
				body,
			},
			env,
			execCtx,
		);
		expect(res.status).toBe(404);
	});

	it("acknowledges duplicate deliveries without crediting twice", async () => {
		const timestamp = "2026-09-15T13:07:00+07:00";
		const signature = await signRequest(
			"POST",
			"/api/webhooks/doku",
			"access-tok-3",
			body,
			timestamp,
		);
		const res = await app.request(
			"/api/webhooks/doku",
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-partner-id": CLIENT_ID,
					"x-timestamp": timestamp,
					"x-signature": signature,
					authorization: "Bearer access-tok-3",
				},
				body,
			},
			env,
			execCtx,
		);
		expect(res.status).toBe(200);
		const json = (await res.json()) as { duplicate?: boolean };
		expect(json.duplicate).toBe(true);
		const n = (
			db.prepare("SELECT COUNT(*) AS n FROM events WHERE payment_provider = 'doku'").get() as {
				n: number;
			}
		).n;
		expect(n).toBe(1);
	});
});
