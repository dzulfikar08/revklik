import { afterEach, describe, expect, it } from "bun:test";
import { deleteAccount } from "../lib/erasure";
import { PURGE_CHUNK } from "../lib/purge";
import { createMigratedTestApp, type MigratedTestApp } from "../lib/test-harness";
import { hashPassword } from "../utils";

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

const count = (t: MigratedTestApp, sql: string, ...params: unknown[]) =>
	(t.db.query(sql).get(...(params as never[])) as { n: number }).n;

/** Everything one visitor leaves behind on one site: browsing, a sale, a profile, heatmap and recording rows. */
function seedVisitor(t: MigratedTestApp, site: string, visitor: string) {
	const p = `${site}-${visitor}`;
	t.db
		.prepare(
			"INSERT INTO events (id, site_id, session_id, visitor_id, path, event_type, revenue, external_id, props, fingerprint, city, browser) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
		)
		.run(
			`${p}-view`,
			site,
			`${p}-s`,
			visitor,
			"/",
			"pageview",
			null,
			null,
			null,
			"s1_ab",
			"Jakarta",
			"Chrome",
		);
	t.db
		.prepare(
			"INSERT INTO events (id, site_id, session_id, visitor_id, path, event_type, revenue, external_id, props, fingerprint, city, browser) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
		)
		.run(
			`${p}-sale`,
			site,
			`${p}-s`,
			visitor,
			"/thanks",
			"conversion",
			49_000,
			`polar:${p}`,
			JSON.stringify({ email: `${visitor}@buyer.test` }),
			"s1_ab",
			"Jakarta",
			"Chrome",
		);
	t.db
		.prepare("INSERT INTO sessions (id, site_id, visitor_id, started_at) VALUES (?,?,?,?)")
		.run(`${p}-s`, site, visitor, new Date().toISOString());
	t.db
		.prepare(
			"INSERT INTO visitor_profiles (id, site_id, visitor_id, name, email, phone, notes) VALUES (?,?,?,?,?,?,?)",
		)
		.run(`${p}-vp`, site, visitor, "Budi", `${visitor}@buyer.test`, "+62811", "VIP");
	t.db
		.prepare(
			"INSERT INTO heatmap_clicks (id, site_id, session_id, visitor_id, path, x, y) VALUES (?,?,?,?,'/',1,1)",
		)
		.run(`${p}-hc`, site, `${p}-s`, visitor);
	t.db
		.prepare(
			"INSERT INTO heatmap_scrolls (id, site_id, session_id, visitor_id, path, max_scroll) VALUES (?,?,?,?,'/',50)",
		)
		.run(`${p}-hs`, site, `${p}-s`, visitor);
	t.db
		.prepare(
			"INSERT INTO session_recordings (id, site_id, session_id, visitor_id, path, events) VALUES (?,?,?,?,'/','[]')",
		)
		.run(`${p}-rec`, site, `${p}-s`, visitor);
}

const rowsOf = (t: MigratedTestApp, site: string, visitor: string) =>
	[
		"events",
		"sessions",
		"visitor_profiles",
		"heatmap_clicks",
		"heatmap_scrolls",
		"session_recordings",
	].map((table) =>
		count(
			t,
			`SELECT COUNT(*) AS n FROM ${table} WHERE site_id = ? AND visitor_id = ?`,
			site,
			visitor,
		),
	);

describe("DELETE /api/sites/:siteId/visitors/:visitorId", () => {
	async function setup() {
		const t = await createMigratedTestApp();
		const owner = await t.seedUser({ id: "u-own", plan: "growth", withSite: "s1" });
		await t.seedUser({ id: "u-other", plan: "growth", withSite: "s2" });
		seedVisitor(t, "s1", "v1");
		seedVisitor(t, "s1", "v2");
		seedVisitor(t, "s2", "v1");
		return { t, owner };
	}

	it("erases the visitor across every table, anonymises their payment, and touches nobody else", async () => {
		const { t, owner } = await setup();

		const res = await t.call("DELETE", "/api/sites/s1/visitors/v1", { token: owner });

		expect(res.status).toBe(200);
		expect((await res.json()) as unknown).toEqual({
			success: true,
			data: {
				events: 1,
				payments_anonymized: 1,
				sessions: 1,
				profiles: 1,
				heatmap_rows: 2,
				recordings: 1,
			},
		});
		expect(rowsOf(t, "s1", "v1")).toEqual([0, 0, 0, 0, 0, 0]);
		// The sale survives for the books with every personal field gone.
		const sale = t.db.query("SELECT * FROM events WHERE id = 's1-v1-sale'").get() as Record<
			string,
			unknown
		>;
		expect(sale).toMatchObject({
			visitor_id: "erased:s1-v1-sale",
			revenue: 49_000,
			external_id: "polar:s1-v1",
			props: null,
			fingerprint: null,
			city: null,
			browser: null,
		});
		// Other visitor on the same site, same visitor id on another site: untouched.
		expect(rowsOf(t, "s1", "v2")).toEqual([2, 1, 1, 1, 1, 1]);
		expect(rowsOf(t, "s2", "v1")).toEqual([2, 1, 1, 1, 1, 1]);
	});

	it("answers 404 for a visitor with nothing stored", async () => {
		const { t, owner } = await setup();
		expect((await t.call("DELETE", "/api/sites/s1/visitors/ghost", { token: owner })).status).toBe(
			404,
		);
	});

	it("refuses strangers and read-only teammates, accepts an editor", async () => {
		const { t } = await setup();
		const stranger = await t.seedUser({ id: "u-str", plan: "growth" });
		const viewer = await t.seedUser({ id: "u-view" });
		const editor = await t.seedUser({ id: "u-edit" });
		const member = (user: string, role: string) =>
			t.db
				.prepare(
					"INSERT INTO team_members (id, site_id, user_id, role, invited_by, accepted_at) VALUES (?, 's1', ?, ?, 'u-own', ?)",
				)
				.run(`tm-${user}`, user, role, new Date().toISOString());
		member("u-view", "viewer");
		member("u-edit", "editor");

		// A stranger cannot learn the site exists (404); a viewer can see it but not write (403).
		for (const [token, status] of [
			[stranger, 404],
			[viewer, 403],
		] as const) {
			expect((await t.call("DELETE", "/api/sites/s1/visitors/v1", { token })).status).toBe(status);
		}
		expect(rowsOf(t, "s1", "v1")).toEqual([2, 1, 1, 1, 1, 1]);
		expect((await t.call("DELETE", "/api/sites/s1/visitors/v1", { token: editor })).status).toBe(
			200,
		);
	});

	it("exports what is stored about a visitor for an access request, readable by a viewer", async () => {
		const { t } = await setup();
		const viewer = await t.seedUser({ id: "u-view" });
		t.db
			.prepare(
				"INSERT INTO team_members (id, site_id, user_id, role, invited_by, accepted_at) VALUES ('tm', 's1', 'u-view', 'viewer', 'u-own', ?)",
			)
			.run(new Date().toISOString());

		const res = await t.call("GET", "/api/sites/s1/visitors/v1/export", { token: viewer });
		const body = (await res.json()) as {
			data: { profile: { email: string }; sessions: unknown[]; events: { id: string }[] };
		};

		expect(res.status).toBe(200);
		expect(body.data.profile.email).toBe("v1@buyer.test");
		expect(body.data.sessions).toHaveLength(1);
		expect(body.data.events.map((e) => e.id).sort()).toEqual(["s1-v1-sale", "s1-v1-view"]);
		expect(
			(await t.call("GET", "/api/sites/s1/visitors/ghost/export", { token: viewer })).status,
		).toBe(404);
	});
});

describe("DELETE /api/auth/account", () => {
	const PASSWORD = "correct horse battery";

	async function setup(env: Record<string, unknown> = {}) {
		const t = await createMigratedTestApp(env);
		const token = await t.seedUser({
			id: "u-del",
			email: "Del@Example.com",
			plan: "growth",
			withSite: "s-del1",
		});
		t.db
			.prepare("UPDATE users SET password_hash = ? WHERE id = 'u-del'")
			.run(await hashPassword(PASSWORD));
		t.db
			.prepare(
				"INSERT INTO sites (id, user_id, name, domain) VALUES ('s-del2','u-del','Two','two.example.com')",
			)
			.run();
		await t.seedUser({ id: "u-keep", plan: "growth", withSite: "s-keep" });
		for (const site of ["s-del1", "s-del2", "s-keep"]) seedVisitor(t, site, "v1");
		const now = new Date().toISOString();
		t.db.exec(`
			INSERT INTO integrations (id, site_id, user_id, type, name, config) VALUES ('int1','s-del1','u-del','kit','Kit','{}');
			INSERT INTO api_keys (id, user_id, key_hash, key_prefix, token_type, site_id) VALUES ('k-site','u-del','h1','rv_','site','s-del1');
			INSERT INTO push_devices (id, user_id, expo_token, platform, created_at, last_seen_at) VALUES ('pd','u-del','ExponentPushToken[x]','ios','${now}','${now}');
			INSERT INTO push_prefs (user_id, updated_at) VALUES ('u-del','${now}');
			INSERT INTO fee_rules (user_id, rail, percent_bps) VALUES ('u-del','stripe',290);
			INSERT INTO account_usage (user_id, month, events) VALUES ('u-del','2026-10',5);
			INSERT INTO pakasir_orders (order_id, user_id, plan, amount, checkout_url) VALUES ('ord1','u-del','growth',192000,'https://pay');
			INSERT INTO affiliates (id, user_id, referral_code) VALUES ('aff1','u-del','CODE1');
			INSERT INTO referrals (id, affiliate_id, referred_user_id) VALUES ('ref1','aff1','u-keep'), ('ref2','aff-other','u-del');
			INSERT INTO account_links (id, user_a, user_b, created_at, created_by) VALUES ('al1','u-del','u-keep','${now}','u-del');
			INSERT INTO login_attempts (key, count, window_start) VALUES ('login-email:del@example.com',1,'${now}'), ('login-email:keep@example.com',1,'${now}');
			INSERT INTO team_members (id, site_id, user_id, role, invited_by) VALUES ('tm-in','s-keep','u-del','viewer','u-keep'), ('tm-out','s-del1','u-keep','viewer','u-del');
		`);
		return { t, token };
	}

	const del = (t: MigratedTestApp, token: string, body: unknown) =>
		t.call("DELETE", "/api/auth/account", { token, body });

	it("removes the account, its sites with every row, and leaves other accounts intact", async () => {
		const { t, token } = await setup();

		const res = await del(t, token, {
			confirm_email: "del@example.com",
			current_password: PASSWORD,
		});

		expect(res.status).toBe(200);
		for (const sql of [
			"SELECT COUNT(*) AS n FROM users WHERE id = 'u-del'",
			"SELECT COUNT(*) AS n FROM api_keys WHERE user_id = 'u-del'",
			"SELECT COUNT(*) AS n FROM subscriptions WHERE user_id = 'u-del'",
			"SELECT COUNT(*) AS n FROM sites WHERE user_id = 'u-del'",
			"SELECT COUNT(*) AS n FROM events WHERE site_id IN ('s-del1','s-del2')",
			"SELECT COUNT(*) AS n FROM sessions WHERE site_id IN ('s-del1','s-del2')",
			"SELECT COUNT(*) AS n FROM visitor_profiles WHERE site_id IN ('s-del1','s-del2')",
			"SELECT COUNT(*) AS n FROM heatmap_clicks WHERE site_id IN ('s-del1','s-del2')",
			"SELECT COUNT(*) AS n FROM session_recordings WHERE site_id IN ('s-del1','s-del2')",
			"SELECT COUNT(*) AS n FROM integrations WHERE user_id = 'u-del'",
			"SELECT COUNT(*) AS n FROM push_devices WHERE user_id = 'u-del'",
			"SELECT COUNT(*) AS n FROM push_prefs WHERE user_id = 'u-del'",
			"SELECT COUNT(*) AS n FROM fee_rules WHERE user_id = 'u-del'",
			"SELECT COUNT(*) AS n FROM account_usage WHERE user_id = 'u-del'",
			"SELECT COUNT(*) AS n FROM affiliates WHERE user_id = 'u-del'",
			"SELECT COUNT(*) AS n FROM referrals",
			"SELECT COUNT(*) AS n FROM account_links",
			"SELECT COUNT(*) AS n FROM team_members WHERE user_id = 'u-del' OR site_id = 's-del1'",
			"SELECT COUNT(*) AS n FROM login_attempts WHERE key = 'login-email:del@example.com'",
		]) {
			expect([sql, count(t, sql)]).toEqual([sql, 0]);
		}
		// Own-billing order stays for replay protection, minus the person.
		expect(t.db.query("SELECT user_id FROM pakasir_orders WHERE order_id = 'ord1'").get()).toEqual({
			user_id: "deleted",
		});
		expect(count(t, "SELECT COUNT(*) AS n FROM users WHERE id = 'u-keep'")).toBe(1);
		expect(rowsOf(t, "s-keep", "v1")).toEqual([2, 1, 1, 1, 1, 1]);
		expect(
			count(
				t,
				"SELECT COUNT(*) AS n FROM login_attempts WHERE key = 'login-email:keep@example.com'",
			),
		).toBe(1);
		expect(count(t, "SELECT COUNT(*) AS n FROM team_members WHERE site_id = 's-keep'")).toBe(0);
	});

	it("needs the right email and password, and deletes nothing otherwise", async () => {
		const { t, token } = await setup();

		const wrongEmail = await del(t, token, {
			confirm_email: "someone@else.com",
			current_password: PASSWORD,
		});
		expect(wrongEmail.status).toBe(400);
		expect(((await wrongEmail.json()) as { error: string }).error).toBe("confirm_email_mismatch");

		const wrongPassword = await del(t, token, {
			confirm_email: "del@example.com",
			current_password: "nope",
		});
		expect(wrongPassword.status).toBe(403);
		expect(((await wrongPassword.json()) as { error: string }).error).toBe(
			"current_password_invalid",
		);

		expect((await t.call("DELETE", "/api/auth/account", { body: {} })).status).toBe(401);
		expect(count(t, "SELECT COUNT(*) AS n FROM users WHERE id = 'u-del'")).toBe(1);
		expect(count(t, "SELECT COUNT(*) AS n FROM events WHERE site_id = 's-del1'")).toBe(2);
	});

	it("cancels the Polar subscription first and deletes nothing when Polar refuses", async () => {
		const { t, token } = await setup({ POLAR_ACCESS_TOKEN: "polar_test" });
		t.db
			.prepare("UPDATE subscriptions SET polar_subscription_id = 'sub_123' WHERE user_id = 'u-del'")
			.run();
		const calls: { url: string; method?: string }[] = [];
		let status = 500;
		globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
			calls.push({ url: String(url), method: init?.method });
			return new Response("{}", { status });
		}) as unknown as typeof fetch;
		const body = { confirm_email: "del@example.com", current_password: PASSWORD };

		const refused = await del(t, token, body);
		expect(refused.status).toBe(502);
		expect(((await refused.json()) as { error: string }).error).toBe("billing_cancel_failed");
		expect(count(t, "SELECT COUNT(*) AS n FROM users WHERE id = 'u-del'")).toBe(1);
		expect(count(t, "SELECT COUNT(*) AS n FROM sites WHERE user_id = 'u-del'")).toBe(2);

		status = 200;
		const done = await del(t, token, body);
		expect(done.status).toBe(200);
		expect(calls.at(-1)).toEqual({
			url: "https://api.polar.sh/v1/subscriptions/sub_123",
			method: "DELETE",
		});
		expect(count(t, "SELECT COUNT(*) AS n FROM users WHERE id = 'u-del'")).toBe(0);
	});
});

describe("deleteAccount on a very large account", () => {
	it("reports unfinished tables and keeps the account until every site is drained", async () => {
		const t = await createMigratedTestApp();
		await t.seedUser({ id: "u-big", withSite: "s-big" });
		const insert = t.db.prepare(
			"INSERT INTO events (id, site_id, session_id, visitor_id, timestamp, path) VALUES (?,?,?,?,?,?)",
		);
		t.db.transaction(() => {
			for (let i = 0; i < PURGE_CHUNK + 7; i++)
				insert.run(`e${i}`, "s-big", "s", "v", "2026-01-01", "/");
		})();

		const first = await deleteAccount(t.d1, "u-big", "u-big@example.com", 1);
		expect(first.unfinished).toContain("events");
		expect(count(t, "SELECT COUNT(*) AS n FROM users WHERE id = 'u-big'")).toBe(1);
		expect(count(t, "SELECT COUNT(*) AS n FROM sites WHERE id = 's-big'")).toBe(1);

		const rest = await deleteAccount(t.d1, "u-big", "u-big@example.com");
		expect(rest.unfinished).toEqual([]);
		expect(count(t, "SELECT COUNT(*) AS n FROM users WHERE id = 'u-big'")).toBe(0);
		expect(count(t, "SELECT COUNT(*) AS n FROM events")).toBe(0);
	});
});
