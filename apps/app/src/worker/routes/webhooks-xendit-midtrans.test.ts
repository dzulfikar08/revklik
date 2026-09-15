import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { createApp } from "../app";
import { makeD1 } from "../lib/test-harness";

/**
 * Xendit + Midtrans webhooks resolve provider config from payment_providers —
 * the table the settings UI writes. Regression: both routes previously read
 * the integrations table, which nothing populates for payment types, so the
 * webhook could never find its provider config (404 on every real delivery).
 * Verification itself is offline: xendit compares a callback token, midtrans
 * recomputes the SHA-512 notification signature.
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

const SITE = "s-xm";
const NOW = new Date().toISOString();
const SERVER_KEY = "SB-Mid-server-test";

db.prepare("INSERT INTO users (id, email, password_hash, name, created_at) VALUES (?,?,?,?,?)").run(
	"u-xm",
	"xm@example.com",
	"x",
	"XM Test",
	NOW,
);
db.prepare("INSERT INTO sites (id, user_id, name, domain, created_at) VALUES (?,?,?,?,?)").run(
	SITE,
	"u-xm",
	"XM Site",
	"xm.example.com",
	NOW,
);
db.prepare(
	"INSERT INTO payment_providers (id, site_id, provider, config, enabled, created_at) VALUES (?,?,?,?,1,?)",
).run("pp-xendit", SITE, "xendit", JSON.stringify({ webhook_secret: "tok-xendit" }), NOW);
db.prepare(
	"INSERT INTO payment_providers (id, site_id, provider, config, enabled, created_at) VALUES (?,?,?,?,1,?)",
).run("pp-midtrans", SITE, "midtrans", JSON.stringify({ server_key: SERVER_KEY }), NOW);
db.prepare("INSERT INTO sessions (id, site_id, visitor_id, started_at) VALUES (?,?,?,?)").run(
	"ses-xm",
	SITE,
	"v-xm",
	NOW,
);

const app = createApp();
const env = { DB: d1, ASSETS: { fetch: async () => new Response("nf", { status: 404 }) } };
const execCtx = {
	waitUntil: () => {},
	passThroughOnException: () => {},
	abort: () => {},
	props: {},
};

async function sha512Hex(input: string): Promise<string> {
	const buf = await crypto.subtle.digest("SHA-512", new TextEncoder().encode(input));
	return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

describe("xendit webhook (payment_providers config)", () => {
	it("attributes a paid invoice when the callback token matches", async () => {
		const res = await app.request(
			"/api/webhooks/xendit",
			{
				method: "POST",
				headers: { "content-type": "application/json", "x-callback-token": "tok-xendit" },
				body: JSON.stringify({
					event: "invoice.paid",
					data: {
						id: "inv-x1",
						external_id: "ext-x1",
						status: "PAID",
						amount: 250000,
						currency: "IDR",
						payment_method: "QR_CODE",
						paid_at: NOW,
						metadata: { revklik_site_id: SITE, revklik_session_id: "ses-xm" },
					},
				}),
			},
			env,
			execCtx,
		);
		expect(res.status).toBe(200);
		const json = (await res.json()) as { success: boolean; amount?: number };
		expect(json.success).toBe(true);
		expect(json.amount).toBe(250000);

		const ev = db
			.prepare(
				'SELECT revenue, payment_provider, visitor_id FROM events WHERE props LIKE \'%"xendit_invoice_id":"inv-x1"%\'',
			)
			.get() as { revenue: number; payment_provider: string; visitor_id: string };
		expect(ev.revenue).toBe(250000);
		expect(ev.payment_provider).toBe("xendit");
		expect(ev.visitor_id).toBe("v-xm");

		// Regression core: the config row came from payment_providers.
		const ppId = (
			db
				.prepare(
					"SELECT integration_id FROM webhook_events WHERE event_type = 'xendit_invoice.paid'",
				)
				.get() as {
				integration_id: string;
			}
		).integration_id;
		expect(ppId).toBe("pp-xendit");
	});

	it("rejects a wrong callback token", async () => {
		const res = await app.request(
			"/api/webhooks/xendit",
			{
				method: "POST",
				headers: { "content-type": "application/json", "x-callback-token": "bad" },
				body: JSON.stringify({
					data: {
						id: "inv-x2",
						status: "PAID",
						amount: 1,
						metadata: { revklik_site_id: SITE },
					},
				}),
			},
			env,
			execCtx,
		);
		expect(res.status).toBe(401);
	});
});

describe("midtrans webhook (payment_providers config)", () => {
	it("attributes a settlement when the signature verifies", async () => {
		const notification = {
			order_id: "ORD-M1",
			status_code: "200",
			gross_amount: "99000.00",
			signature_key: await sha512Hex(`ORD-M120099000.00${SERVER_KEY}`),
			transaction_status: "settlement",
			payment_type: "gopay",
			transaction_time: NOW,
			custom_field1: "ses-xm",
			custom_field4: SITE,
		};
		const res = await app.request(
			"/api/webhooks/midtrans",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(notification),
			},
			env,
			execCtx,
		);
		expect(res.status).toBe(200);
		const json = (await res.json()) as { success: boolean; revenue?: number };
		expect(json.revenue).toBe(99000);

		const ev = db
			.prepare(
				'SELECT revenue, payment_provider, visitor_id FROM events WHERE props LIKE \'%"order_id":"ORD-M1"%\'',
			)
			.get() as { revenue: number; payment_provider: string; visitor_id: string };
		expect(ev.revenue).toBe(99000);
		expect(ev.payment_provider).toBe("midtrans");
		expect(ev.visitor_id).toBe("v-xm");

		const ppId = (
			db
				.prepare(
					"SELECT integration_id FROM webhook_events WHERE event_type = 'midtrans_settlement'",
				)
				.get() as { integration_id: string }
		).integration_id;
		expect(ppId).toBe("pp-midtrans");
	});

	it("rejects an invalid signature", async () => {
		const res = await app.request(
			"/api/webhooks/midtrans",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					order_id: "ORD-M2",
					status_code: "200",
					gross_amount: "99000.00",
					signature_key: "deadbeef",
					transaction_status: "settlement",
					custom_field4: SITE,
				}),
			},
			env,
			execCtx,
		);
		expect(res.status).toBe(401);
	});
});
