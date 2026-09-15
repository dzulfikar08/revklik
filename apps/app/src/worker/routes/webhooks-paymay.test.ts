import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { createApp } from "../app";
import { makeD1 } from "../lib/test-harness";

/**
 * Paywuz + Mayar webhook routes: secret-token verification, revenue
 * attribution (event + visitor profile), dedupe by provider transaction id,
 * and site/provider resolution failures. Configs here use webhook_secret
 * only, so no network is touched: with a matching x-webhook-token the
 * provider-attested body is creditable (xendit/stripe model); api_key mode
 * re-verifies against the provider API and is exercised in production.
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

const SITE = "s-pm";
const NOW = new Date().toISOString();

db.prepare("INSERT INTO users (id, email, password_hash, name, created_at) VALUES (?,?,?,?,?)").run(
	"u-pm",
	"pm@example.com",
	"x",
	"PM Test",
	NOW,
);
db.prepare("INSERT INTO sites (id, user_id, name, domain, created_at) VALUES (?,?,?,?,?)").run(
	SITE,
	"u-pm",
	"PM Site",
	"pm.example.com",
	NOW,
);
db.prepare(
	"INSERT INTO payment_providers (id, site_id, provider, config, enabled, created_at) VALUES (?,?,?,?,1,?)",
).run("pp-paywuz", SITE, "paywuz", JSON.stringify({ webhook_secret: "tok-paywuz" }), NOW);
db.prepare(
	"INSERT INTO payment_providers (id, site_id, provider, config, enabled, created_at) VALUES (?,?,?,?,1,?)",
).run("pp-mayar", SITE, "mayar", JSON.stringify({ webhook_secret: "tok-mayar" }), NOW);
db.prepare("INSERT INTO sessions (id, site_id, visitor_id, started_at) VALUES (?,?,?,?)").run(
	"ses-attrib",
	SITE,
	"v-attrib",
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

function post(path: string, token: string | null, body: Record<string, unknown>) {
	const headers: Record<string, string> = { "content-type": "application/json" };
	if (token) headers["x-webhook-token"] = token;
	return app.request(path, { method: "POST", headers, body: JSON.stringify(body) }, env, execCtx);
}

describe("paywuz webhook", () => {
	it("attributes a paid order: session attribution, utm passthrough, revenue credit", async () => {
		const res = await post("/api/webhooks/paywuz", "tok-paywuz", {
			orderId: "PW-1001",
			amount: 150000,
			status: "SUCCESS",
			metadata: {
				revklik_site_id: SITE,
				revklik_session_id: "ses-attrib",
				revklik_utm_source: "whatsapp",
			},
		});
		expect(res.status).toBe(200);
		const json = (await res.json()) as { success: boolean; amount: number };
		expect(json.success).toBe(true);
		expect(json.amount).toBe(150000);

		const ev = db
			.prepare(
				'SELECT revenue, payment_provider, payment_method, utm_source, visitor_id FROM events WHERE props LIKE \'%"paywuz_order_id":"PW-1001"%\'',
			)
			.get() as {
			revenue: number;
			payment_provider: string;
			utm_source: string;
			visitor_id: string;
		};
		expect(ev.revenue).toBe(150000);
		expect(ev.payment_provider).toBe("paywuz");
		expect(ev.utm_source).toBe("whatsapp");
		expect(ev.visitor_id).toBe("v-attrib"); // resolved from the session

		const profile = db
			.prepare("SELECT total_revenue FROM visitor_profiles WHERE visitor_id = 'v-attrib'")
			.get() as { total_revenue: number };
		expect(profile.total_revenue).toBe(150000);
	});

	it("acknowledges duplicate deliveries without crediting twice", async () => {
		const res = await post("/api/webhooks/paywuz", "tok-paywuz", {
			orderId: "PW-1001",
			amount: 150000,
			metadata: { revklik_site_id: SITE },
		});
		expect(res.status).toBe(200);
		const json = (await res.json()) as { duplicate?: boolean };
		expect(json.duplicate).toBe(true);
		const n = (
			db.prepare("SELECT COUNT(*) AS n FROM events WHERE payment_provider = 'paywuz'").get() as {
				n: number;
			}
		).n;
		expect(n).toBe(1);
	});

	it("rejects a bad token and logs the failure", async () => {
		const res = await post("/api/webhooks/paywuz", "wrong-token", {
			orderId: "PW-1002",
			amount: 1,
			metadata: { revklik_site_id: SITE },
		});
		expect(res.status).toBe(401);
		const failed = db
			.prepare("SELECT COUNT(*) AS n FROM webhook_events WHERE event_type = 'paywuz_invalid_token'")
			.get() as { n: number };
		expect(failed.n).toBe(1);
	});

	it("requires a site id and an existing provider", async () => {
		expect((await post("/api/webhooks/paywuz", "tok-paywuz", { orderId: "PW-3" })).status).toBe(
			400,
		);
		expect(
			(
				await post("/api/webhooks/paywuz", "tok-paywuz", {
					orderId: "PW-4",
					metadata: { revklik_site_id: "s-unknown" },
				})
			).status,
		).toBe(404);
	});
});

describe("mayar webhook", () => {
	it("attributes a settled payment with visitor fallback id", async () => {
		const res = await post("/api/webhooks/mayar", "tok-mayar", {
			id: "MYR-2001",
			amount: 99000,
			status: "settled",
			metadata: { revklik_site_id: SITE, revklik_visitor_id: "v-myr" },
		});
		expect(res.status).toBe(200);
		const json = (await res.json()) as { success: boolean; amount: number };
		expect(json.amount).toBe(99000);

		const ev = db
			.prepare(
				'SELECT revenue, payment_provider FROM events WHERE props LIKE \'%"mayar_transaction_id":"MYR-2001"%\'',
			)
			.get() as { revenue: number; payment_provider: string };
		expect(ev.revenue).toBe(99000);
		expect(ev.payment_provider).toBe("mayar");

		const profile = db
			.prepare("SELECT total_revenue FROM visitor_profiles WHERE visitor_id = 'v-myr'")
			.get() as { total_revenue: number };
		expect(profile.total_revenue).toBe(99000);
	});

	it("rejects a bad token", async () => {
		const res = await post("/api/webhooks/mayar", "nope", {
			id: "MYR-2002",
			metadata: { revklik_site_id: SITE },
		});
		expect(res.status).toBe(401);
	});
});

describe("non-paid statuses", () => {
	it("acknowledges without crediting", async () => {
		const res = await post("/api/webhooks/paywuz", "tok-paywuz", {
			orderId: "PW-EXP",
			amount: 5,
			status: "EXPIRED",
			metadata: { revklik_site_id: SITE },
		});
		expect(res.status).toBe(200);
		const json = (await res.json()) as { action?: string };
		expect(json.action).toBe("logged_not_paid");
		const n = (
			db.prepare("SELECT COUNT(*) AS n FROM events WHERE props LIKE '%PW-EXP%'").get() as {
				n: number;
			}
		).n;
		expect(n).toBe(0);
	});
});
