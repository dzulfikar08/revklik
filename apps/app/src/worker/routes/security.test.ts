import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { allowRequest, checkLocalLimit, type RateLimitBinding } from "../lib/rate-limit";
import { signOAuthState, verifyOAuthState } from "../lib/oauth-state";
import { createMigratedTestApp, type MigratedTestApp } from "../lib/test-harness";

const SITE = "s-sec";
const now = new Date().toISOString();

interface Json {
	data?: Record<string, unknown>;
	error?: string;
}

async function body(res: Response): Promise<Json> {
	return res.json();
}

async function setup(env: Record<string, unknown> = {}) {
	const t = await createMigratedTestApp(env);
	const owner = await t.seedUser({ id: "u-owner", withSite: SITE, plan: "growth" });
	const viewer = await t.seedUser({ id: "u-viewer", plan: "growth" });
	const stranger = await t.seedUser({ id: "u-stranger", plan: "growth" });
	t.db
		.prepare(
			"INSERT INTO team_members (id, site_id, user_id, role, invited_by, invited_at, accepted_at) VALUES ('tm-v', ?, 'u-viewer', 'viewer', 'u-owner', ?, ?)",
		)
		.run(SITE, now, now);
	return { t, owner, viewer, stranger };
}

async function mint(
	t: MigratedTestApp,
	token: string,
	route: "/api/tokens" | "/api/v1/tokens",
	payload: Record<string, unknown>,
) {
	const res = await t.call("POST", route, { token, body: payload });
	return { res, json: await body(res) };
}

describe("token scope escalation", () => {
	it("an API token cannot mint tokens:write, scopes it lacks, or tokens from a site token", async () => {
		const { t, owner } = await setup();
		const dashboard = await mint(t, owner, "/api/tokens", {
			name: "ci",
			type: "account",
			scopes: ["analytics:read", "tokens:write"],
		});
		expect(dashboard.res.status).toBe(201);
		const minter = String(dashboard.json.data?.token);

		const grantsWrite = await mint(t, minter, "/api/v1/tokens", {
			name: "worse",
			type: "account",
			scopes: ["analytics:read", "tokens:write"],
		});
		expect(grantsWrite.res.status).toBe(403);

		const grantsExport = await mint(t, minter, "/api/v1/tokens", {
			name: "worse",
			type: "account",
			scopes: ["analytics:read", "analytics:export"],
		});
		expect(grantsExport.res.status).toBe(403);
		expect(grantsExport.json.error).toContain("analytics:export");

		const weaker = await mint(t, minter, "/api/v1/tokens", {
			name: "reader",
			type: "account",
			scopes: ["analytics:read"],
		});
		expect(weaker.res.status).toBe(201);
		expect(weaker.json.data?.scopes).toEqual(["analytics:read"]);

		// Defaults are capped to what the minting token holds, never tokens:write.
		const defaults = await mint(t, minter, "/api/v1/tokens", { name: "d", type: "account" });
		expect(defaults.json.data?.scopes).toEqual(["analytics:read"]);

		const siteToken = await mint(t, owner, "/api/tokens", {
			name: "site",
			type: "site",
			site_id: SITE,
			scopes: ["analytics:read"],
		});
		const fromSite = await mint(t, String(siteToken.json.data?.token), "/api/v1/tokens", {
			name: "x",
			type: "account",
		});
		expect(fromSite.res.status).toBe(403);
	});

	it("a site token for events needs a write role on the site", async () => {
		const { t, viewer, stranger } = await setup();
		const events = { name: "srv", type: "site", site_id: SITE, scopes: ["events:write"] };
		expect((await mint(t, viewer, "/api/tokens", events)).res.status).toBe(403);
		expect((await mint(t, stranger, "/api/tokens", events)).res.status).toBe(404);
		const read = await mint(t, viewer, "/api/tokens", { ...events, scopes: ["analytics:read"] });
		expect(read.res.status).toBe(201);
	});
});

describe("account tokens inherit the owner's role", () => {
	const sale = { site_id: SITE, name: "Sale", revenue: 99, external_id: "sale-1" };

	it("a viewer's account token with events:write cannot book a server sale", async () => {
		const { t, viewer } = await setup();
		const minted = await mint(t, viewer, "/api/tokens", {
			name: "viewer-writer",
			type: "account",
			scopes: ["events:write"],
		});
		expect(minted.res.status).toBe(201);
		const res = await t.call("POST", "/api/v1/events/server", {
			token: String(minted.json.data?.token),
			body: sale,
		});
		expect(res.status).toBe(403);
		expect(t.db.query("SELECT COUNT(*) AS n FROM events WHERE revenue > 0").get()).toEqual({
			n: 0,
		});
	});

	it("the owner's account token with events:write still books it", async () => {
		const { t, owner } = await setup();
		const minted = await mint(t, owner, "/api/tokens", {
			name: "owner-writer",
			type: "account",
			scopes: ["events:write"],
		});
		const res = await t.call("POST", "/api/v1/events/server", {
			token: String(minted.json.data?.token),
			body: sale,
		});
		expect(res.status).toBe(200);
	});
});

describe("POST /api/track/payment", () => {
	it("books revenue only for a token with events:write on that site", async () => {
		const { t, owner, viewer } = await setup();
		const payment = { s: SITE, amount: 49, transaction_id: "trk-1" };
		expect((await t.call("POST", "/api/track/payment", { body: payment })).status).toBe(401);

		const readOnly = await mint(t, owner, "/api/tokens", {
			name: "ro",
			type: "site",
			site_id: SITE,
			scopes: ["analytics:read"],
		});
		const noScope = await t.call("POST", "/api/track/payment", {
			token: String(readOnly.json.data?.token),
			body: payment,
		});
		expect(noScope.status).toBe(403);

		// A session token is not an API credential.
		expect(
			(await t.call("POST", "/api/track/payment", { token: viewer, body: payment })).status,
		).toBe(401);

		const writer = await mint(t, owner, "/api/tokens", {
			name: "srv",
			type: "site",
			site_id: SITE,
			scopes: ["events:write"],
		});
		const token = String(writer.json.data?.token);
		const elsewhere = await t.call("POST", "/api/track/payment", {
			token,
			body: { ...payment, s: "another-site" },
		});
		expect(elsewhere.status).toBe(403);
		expect(t.db.query("SELECT COUNT(*) AS n FROM events").get()).toEqual({ n: 0 });

		const ok = await t.call("POST", "/api/track/payment", { token, body: payment });
		expect(ok.status).toBe(200);
		expect(t.db.query("SELECT COUNT(*) AS n FROM events WHERE revenue > 0").get()).toEqual({
			n: 1,
		});
	});
});

describe("POST /api/identify", () => {
	async function seedVisitor(t: MigratedTestApp) {
		t.db
			.prepare(
				"INSERT INTO visitor_profiles (id, site_id, visitor_id) VALUES ('vp', ?, 'vid-known')",
			)
			.run(SITE);
	}
	const profile = (t: MigratedTestApp) =>
		t.db.query("SELECT visitor_id, name, email FROM visitor_profiles ORDER BY visitor_id").all();

	it("only identifies a visitor the site has already recorded", async () => {
		const { t } = await setup();
		await seedVisitor(t);
		const forged = await t.call("POST", "/api/identify", {
			body: { s: SITE, vid: "guess", name: "Mallory", email: "m@evil.test" },
		});
		expect(forged.status).toBe(404);
		const otherSite = await t.call("POST", "/api/identify", {
			body: { s: "nope", vid: "vid-known", name: "x" },
		});
		expect(otherSite.status).toBe(404);
		expect(profile(t)).toEqual([{ visitor_id: "vid-known", name: null, email: null }]);

		const ok = await t.call("POST", "/api/identify", {
			body: { s: SITE, vid: "vid-known", name: "Sari", email: "sari@example.com" },
		});
		expect(ok.status).toBe(202);
		expect(profile(t)).toEqual([
			{ visitor_id: "vid-known", name: "Sari", email: "sari@example.com" },
		]);
	});

	it("caps field sizes and refuses non-https avatars", async () => {
		const { t } = await setup();
		await seedVisitor(t);
		const bad = await t.call("POST", "/api/identify", {
			body: { s: SITE, vid: "vid-known", avatar: "javascript:alert(1)" },
		});
		expect(bad.status).toBe(400);
		await t.call("POST", "/api/identify", {
			body: { s: SITE, vid: "vid-known", name: "n".repeat(5000) },
		});
		const row = t.db.query("SELECT name FROM visitor_profiles").get() as { name: string };
		expect(row.name).toHaveLength(200);
	});
});

describe("GET /api/widget-data", () => {
	it("refuses session tokens, scopeless tokens and tokens bound to another site", async () => {
		const { t, owner } = await setup();
		const url = (key: string) => `/api/widget-data?site_id=${SITE}&api_key=${key}`;
		expect((await t.call("GET", url(owner))).status).toBe(401);

		const noScope = await mint(t, owner, "/api/tokens", {
			name: "ev",
			type: "site",
			site_id: SITE,
			scopes: ["events:write"],
		});
		expect((await t.call("GET", url(String(noScope.json.data?.token)))).status).toBe(403);

		const reader = await mint(t, owner, "/api/tokens", {
			name: "widget",
			type: "site",
			site_id: SITE,
			scopes: ["analytics:read"],
		});
		const token = String(reader.json.data?.token);
		expect((await t.call("GET", url(token))).status).toBe(200);
		expect((await t.call("GET", `/api/widget-data?site_id=other&api_key=${token}`)).status).toBe(
			403,
		);

		t.db
			.prepare("UPDATE api_keys SET expires_at = '2020-01-01T00:00:00.000Z' WHERE name = 'widget'")
			.run();
		expect((await t.call("GET", url(token))).status).toBe(401);
	});
});

describe("Google Search Console OAuth", () => {
	const SECRET = "google-client-secret";

	it("refuses a callback whose state was not signed for a real session", async () => {
		const { t } = await setup({ GOOGLE_CLIENT_SECRET: SECRET, GOOGLE_CLIENT_ID: "id" });
		const forgedJson = Buffer.from(
			JSON.stringify({ u: "u-owner", s: SITE, exp: Date.now() + 60_000 }),
		).toString("base64url");
		for (const state of [
			JSON.stringify({ site_id: SITE, nonce: "n" }),
			`${forgedJson}.AAAA`,
			await signOAuthState("another-secret", { u: "u-owner", s: SITE }),
			await signOAuthState(SECRET, { u: "u-owner", s: SITE }, Date.now() - 3_600_000),
		]) {
			const res = await t.call(
				"GET",
				`/api/gsc/callback?code=c&state=${encodeURIComponent(state)}`,
			);
			expect(res.status).toBe(400);
		}
		expect(t.db.query("SELECT COUNT(*) AS n FROM integrations").get()).toEqual({ n: 0 });
	});

	it("refuses a signed state for a user who may not connect credentials to the site", async () => {
		const { t } = await setup({ GOOGLE_CLIENT_SECRET: SECRET });
		const state = await signOAuthState(SECRET, { u: "u-viewer", s: SITE });
		const res = await t.call("GET", `/api/gsc/callback?code=c&state=${encodeURIComponent(state)}`);
		expect(res.status).toBe(403);
		expect(t.db.query("SELECT COUNT(*) AS n FROM integrations").get()).toEqual({ n: 0 });
	});

	it("starts the flow only for an authenticated admin or owner, with a verifiable state", async () => {
		const { t, owner, viewer } = await setup({
			GOOGLE_CLIENT_SECRET: SECRET,
			GOOGLE_CLIENT_ID: "id",
		});
		expect((await t.call("GET", `/api/gsc/auth?site_id=${SITE}`)).status).toBe(404);
		expect((await t.call("POST", "/api/gsc/auth-url", { body: { site_id: SITE } })).status).toBe(
			401,
		);
		expect(
			(await t.call("POST", "/api/gsc/auth-url", { token: viewer, body: { site_id: SITE } }))
				.status,
		).toBe(403);
		const ok = await t.call("POST", "/api/gsc/auth-url", { token: owner, body: { site_id: SITE } });
		expect(ok.status).toBe(200);
		const url = new URL(String((await body(ok)).data?.url));
		const state = url.searchParams.get("state") ?? "";
		expect(await verifyOAuthState(SECRET, state)).toEqual({ u: "u-owner", s: SITE });
	});
});

describe("webhook activity logs", () => {
	it("are no longer readable by anyone who knows a site id", async () => {
		const { t, viewer, stranger } = await setup();
		const url = `/api/webhooks/stripe/test?siteId=${SITE}`;
		expect((await t.call("GET", url)).status).toBe(401);
		expect((await t.call("GET", url, { token: stranger })).status).toBe(404);
		expect((await t.call("GET", url, { token: viewer })).status).toBe(200);
	});
});

describe("generic email-list webhooks", () => {
	function integration(t: MigratedTestApp, type: string, config: Record<string, string>) {
		// Events are only recorded for a known subscriber.
		t.db
			.prepare(
				"INSERT OR IGNORE INTO visitor_profiles (id, site_id, visitor_id, email) VALUES ('vp-sub', ?, 'vid-sub', 'sari@example.com')",
			)
			.run(SITE);
		t.db
			.prepare(
				"INSERT INTO integrations (id, site_id, user_id, type, name, config) VALUES (?, ?, 'u-owner', ?, ?, ?)",
			)
			.run(`in-${type}`, SITE, type, type, JSON.stringify(config));
	}
	const events = (t: MigratedTestApp) =>
		t.db.query("SELECT COUNT(*) AS n FROM events WHERE device_type = 'webhook'").get();

	it("refuse every request while no secret is saved", async () => {
		const { t } = await setup();
		for (const type of ["mailchimp", "convertkit", "kit", "beehiiv"]) integration(t, type, {});
		for (const type of ["mailchimp", "convertkit", "kit", "beehiiv"]) {
			const res = await t.call("POST", `/api/webhooks/${type}?site_id=${SITE}`, {
				body: { type: "subscribe", email: "sari@example.com", data: { email: "sari@example.com" } },
			});
			expect(res.status, type).toBe(401);
		}
		expect(events(t)).toEqual({ n: 0 });
	});

	it("accept a Mailchimp form post carrying the URL token", async () => {
		const { t } = await setup();
		integration(t, "mailchimp", { webhook_secret: "tok-123" });
		const form = "type=subscribe&data%5Bemail%5D=sari%40example.com";
		const headers = { "content-type": "application/x-www-form-urlencoded" };
		const wrong = await t.call("POST", `/api/webhooks/mailchimp?site_id=${SITE}&token=nope`, {
			body: form,
			headers,
		});
		expect(wrong.status).toBe(401);
		const ok = await t.call("POST", `/api/webhooks/mailchimp?site_id=${SITE}&token=tok-123`, {
			body: form,
			headers,
		});
		expect(ok.status).toBe(200);
		expect(events(t)).toEqual({ n: 1 });
	});
});

describe("error responses", () => {
	it("do not echo internal error text", async () => {
		const { t, owner } = await setup();
		const res = await t.call("POST", "/api/annotations", { token: owner, body: "{not json" });
		expect(res.status).toBe(500);
		const json = await body(res);
		expect(json.error).toBe("Internal server error");
		expect(JSON.stringify(json)).not.toMatch(/JSON|token|position/i);
	});
});

describe("rate limiting", () => {
	const binding = (outcomes: boolean[]): RateLimitBinding => ({
		limit: async () => ({ success: outcomes.shift() ?? true }),
	});
	let realError: typeof console.error;
	beforeEach(() => {
		realError = console.error;
		console.error = () => {};
	});
	afterEach(() => {
		console.error = realError;
	});

	it("follows the Workers binding when one is configured", async () => {
		const limiter = binding([true, false]);
		expect(await allowRequest(limiter, "ip", 1)).toBe(true);
		expect(await allowRequest(limiter, "ip", 1)).toBe(false);
	});

	it("lets traffic through when the binding itself fails", async () => {
		const broken: RateLimitBinding = {
			limit: async () => {
				throw new Error("limiter down");
			},
		};
		expect(await allowRequest(broken, "ip", 1)).toBe(true);
	});

	it("falls back to a per-key in-memory window without a binding", async () => {
		const key = `fallback-${Math.random()}`;
		expect(checkLocalLimit(key, 2).allowed).toBe(true);
		expect(checkLocalLimit(key, 2).allowed).toBe(true);
		expect(checkLocalLimit(key, 2).allowed).toBe(false);
		expect(checkLocalLimit(`${key}-other`, 2).allowed).toBe(true);
	});
});
