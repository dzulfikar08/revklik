import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import type { Kysely } from "kysely";
import { createApp } from "../app";
import { makeD1 } from "./test-harness";
import { createDb } from "../db";
import { getReferrers } from "../queries/analytics";
import { queryReferrers } from "./public-api-queries";
import { migrateDatabase } from "../migrations";
import type { KlikapaDatabase } from "@revklik/shared";

/**
 * WhatsApp source attribution (DEV-20): WhatsApp in-app browsers strip the
 * Referer and report Chrome/Safari via the client-side parse, so their clicks
 * land as 'direct' — or worse, the iOS in-app browser UA (which carries the
 * WhatsApp token) was discarded as a bot. The bot list now only flags the bare
 * "WhatsApp/x.y" link-preview UA, ingest overrides browser to 'WhatsApp' for
 * human UAs carrying the token, and the source SQL classifies referrer-less
 * WhatsApp traffic as 'whatsapp' (utm_source still wins).
 */

const db = new Database(":memory:");
const d1 = makeD1(db);
await migrateDatabase(d1 as unknown as D1Database);
const kysely = createDb(d1 as never) as Kysely<KlikapaDatabase>;

const SITE = "s-wa";
const NOW = Date.now();
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

db.prepare(
	"INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?,?,?,?,?,?)",
).run("u-wa", "wa@example.com", "x", "WA Test", "super_admin", iso(0));
db.prepare("INSERT INTO sites (id, user_id, name, domain, created_at) VALUES (?,?,?,?,?)").run(
	SITE,
	"u-wa",
	"WA Site",
	"wa.example.com",
	iso(0),
);

function seedEvent(opts: {
	id: string;
	visitor: string;
	referrer?: string | null;
	utmSource?: string | null;
	browser?: string | null;
	path?: string;
}) {
	db.prepare(
		"INSERT INTO events (id, site_id, session_id, visitor_id, timestamp, event_type, path, referrer, utm_source, browser, device_type) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
	).run(
		opts.id,
		SITE,
		`ses-${opts.id}`,
		opts.visitor,
		iso(60_000),
		"pageview",
		opts.path ?? "/",
		opts.referrer ?? null,
		opts.utmSource ?? null,
		opts.browser ?? null,
		"mobile",
	);
}

// Referrer-less + WhatsApp browser → whatsapp; Chrome → direct; utm wins;
// real referrers keep the hostname logic.
seedEvent({ id: "e-wa", visitor: "v-wa", browser: "WhatsApp" });
seedEvent({ id: "e-ch", visitor: "v-ch", browser: "Chrome" });
seedEvent({ id: "e-utm", visitor: "v-utm", browser: "WhatsApp", utmSource: "newsletter" });
seedEvent({ id: "e-tco", visitor: "v-tco", referrer: "https://t.co/abc", browser: "Chrome" });
seedEvent({ id: "e-fb", visitor: "v-fb", referrer: "https://m.facebook.com/x", browser: "Chrome" });

const startIso = iso(7 * 86_400_000);

describe("dashboard sourceSql (getReferrers)", () => {
	it("classifies referrer-less WhatsApp traffic as whatsapp", async () => {
		const rows = await getReferrers(kysely, SITE, startIso, 10);
		const bySource = new Map(rows.map((r) => [r.source, r.visitors]));
		expect(bySource.get("whatsapp")).toBe(1);
		expect(bySource.get("direct")).toBe(1); // only the Chrome click
		expect(bySource.get("newsletter")).toBe(1); // utm_source wins over whatsapp
		expect(bySource.get("twitter")).toBe(1); // t.co mapping intact
		expect(bySource.get("facebook")).toBe(1); // m.facebook.com mapping intact
	});
});

describe("public API sourceExpr (queryReferrers)", () => {
	it("mirrors the whatsapp classification", async () => {
		const rows = await queryReferrers(
			{
				db: kysely,
				userId: "u-wa",
				tokenScopes: ["analytics:read"],
				tokenSiteId: null,
				tokenType: "account",
			},
			SITE,
			"7d",
			10,
		);
		const bySource = new Map(rows.map((r) => [r.source, r.visitors]));
		expect(bySource.get("whatsapp")).toBe(1);
		expect(bySource.get("direct")).toBe(1);
		expect(bySource.get("newsletter")).toBe(1);
	});
});

describe("ingest UA override (POST /api/track)", () => {
	it("stores browser=WhatsApp for WhatsApp UAs and leaves others alone", async () => {
		const app = createApp();
		const env = { DB: d1, ASSETS: { fetch: async () => new Response("nf", { status: 404 }) } };
		// The track handler fire-and-forgets work via waitUntil — stub the ctx.
		const execCtx = {
			waitUntil: () => {},
			passThroughOnException: () => {},
			abort: () => {},
			props: {},
		};
		const post = (ua: string, vid: string) =>
			app.request(
				"/api/track",
				{
					method: "POST",
					headers: { "content-type": "application/json", "user-agent": ua },
					body: JSON.stringify([
						{
							s: SITE,
							sid: `sid-${vid}`,
							vid,
							t: "p",
							p: "/",
							dv: "mobile",
							br: "Chrome",
							os: "Android",
						},
					]),
				},
				env,
				execCtx,
			);

		// iOS in-app browser: real browser UA carrying the WhatsApp token.
		const wa = await post(
			"Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhatsApp/2.24.12.79",
			"v-ingest-wa",
		);
		expect(wa.status).toBe(202); // track always answers 202 Accepted

		const chrome = await post(
			"Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119 Mobile Safari/537.36",
			"v-ingest-ch",
		);
		expect(chrome.status).toBe(202);

		const rows = db
			.prepare(
				"SELECT visitor_id, browser FROM events WHERE visitor_id IN ('v-ingest-wa','v-ingest-ch')",
			)
			.all() as Array<{ visitor_id: string; browser: string }>;
		const byVisitor = new Map(rows.map((r) => [r.visitor_id, r.browser]));
		expect(byVisitor.get("v-ingest-wa")).toBe("WhatsApp");
		expect(byVisitor.get("v-ingest-ch")).toBe("Chrome");

		// The stored override flows through attribution:
		const sources = await getReferrers(kysely, SITE, startIso, 10);
		const waVisitors = sources.find((r) => r.source === "whatsapp")?.visitors ?? 0;
		expect(waVisitors).toBeGreaterThanOrEqual(1);
	});
});
