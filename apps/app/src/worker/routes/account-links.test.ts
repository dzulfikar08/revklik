import { afterEach, describe, expect, it } from "bun:test";
import { MAX_ACCOUNT_LINKS } from "../lib/account-links";
import { createMigratedTestApp, settleWaitUntil, type MigratedTestApp } from "../lib/test-harness";
import { generateApiKey, hashPassword, hashToken } from "../utils";

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

const PASSWORD = "correct-horse";
type Json = { success: boolean; error?: string; data?: Record<string, unknown> };

async function setup() {
	const t = await createMigratedTestApp();
	const tokens: Record<string, string> = {};
	const hash = await hashPassword(PASSWORD);
	for (const id of ["alice", "bob", "carol"]) {
		tokens[id] = await t.seedUser({ id });
		t.db
			.prepare("UPDATE users SET password_hash = ?, email_verified_at = ? WHERE id = ?")
			.run(hash, new Date().toISOString(), id);
	}
	return { t, tokens };
}

const link = (
	t: MigratedTestApp,
	token: string,
	email: string,
	password = PASSWORD,
	currentPassword = PASSWORD,
) =>
	t.call("POST", "/api/auth/links", {
		token,
		body: { email, password, current_password: currentPassword },
	});

interface LinkListItem {
	id: string;
	user: { id: string; email: string };
}

const list = async (t: MigratedTestApp, token: string): Promise<LinkListItem[]> => {
	const res = await t.call("GET", "/api/auth/links", { token });
	const body = (await res.json()) as { data: LinkListItem[] };
	return body.data;
};

describe("linked accounts: password", () => {
	it("links two accounts once and lists them from both sides", async () => {
		const { t, tokens } = await setup();
		const res = await link(t, tokens.alice!, "bob@example.com");
		expect(res.status).toBe(201);
		const body = (await res.json()) as Json;
		expect(body.data).toMatchObject({ user: { id: "bob" } });

		expect((await list(t, tokens.alice!)).map((l) => l.user.id)).toEqual(["bob"]);
		expect((await list(t, tokens.bob!)).map((l) => l.user.id)).toEqual(["alice"]);
		const row = t.db.query("SELECT user_a, user_b, created_by FROM account_links").get() as {
			user_a: string;
			user_b: string;
			created_by: string;
		};
		expect(row).toEqual({ user_a: "alice", user_b: "bob", created_by: "alice" });
	});

	it("rejects a wrong password with 401 and throttles guessing", async () => {
		const { t, tokens } = await setup();
		const bad = await link(t, tokens.alice!, "bob@example.com", "nope-nope");
		expect(bad.status).toBe(401);
		expect(await list(t, tokens.alice!)).toEqual([]);
		for (let i = 0; i < 9; i++) await link(t, tokens.alice!, "bob@example.com", "nope-nope");
		const limited = await link(t, tokens.alice!, "bob@example.com");
		expect(limited.status).toBe(429);
	});

	it("refuses self, unknown email and Google-only accounts", async () => {
		const { t, tokens } = await setup();
		expect((await link(t, tokens.alice!, "alice@example.com")).status).toBe(400);
		expect((await link(t, tokens.alice!, "ghost@example.com")).status).toBe(401);
		t.db.prepare("UPDATE users SET password_hash = '' WHERE id = 'carol'").run();
		expect((await link(t, tokens.alice!, "carol@example.com", "")).status).toBe(401);
	});

	it("refuses a duplicate from either side", async () => {
		const { t, tokens } = await setup();
		expect((await link(t, tokens.alice!, "bob@example.com")).status).toBe(201);
		const again = await link(t, tokens.alice!, "bob@example.com");
		expect(again.status).toBe(409);
		expect(((await again.json()) as Json).error).toBe("already_linked");
		expect((await link(t, tokens.bob!, "alice@example.com")).status).toBe(409);
		expect((t.db.query("SELECT COUNT(*) AS n FROM account_links").get() as { n: number }).n).toBe(
			1,
		);
	});

	it("caps links per user", async () => {
		const { t, tokens } = await setup();
		const hash = await hashPassword(PASSWORD);
		for (let i = 0; i < MAX_ACCOUNT_LINKS; i++) {
			await t.seedUser({ id: `extra${i}` });
			t.db
				.prepare("UPDATE users SET password_hash = ?, email_verified_at = ? WHERE id = ?")
				.run(hash, new Date().toISOString(), `extra${i}`);
			expect((await link(t, tokens.alice!, `extra${i}@example.com`)).status).toBe(201);
		}
		const over = await link(t, tokens.alice!, "bob@example.com");
		expect(over.status).toBe(409);
		expect(((await over.json()) as Json).error).toBe("limit_reached");
		// the target's own cap counts too
		const capped = await link(t, tokens.bob!, "extra0@example.com");
		expect(capped.status).toBe(201);
	});

	it("rejects non-session tokens", async () => {
		const { t } = await setup();
		const { key } = generateApiKey("account");
		t.db
			.prepare(
				"INSERT INTO api_keys (id, user_id, key_hash, key_prefix, name, token_type, created_at) VALUES ('k1','alice',?,?,?,?,?)",
			)
			.run(await hashToken(key), key.slice(0, 7), "api", "account", new Date().toISOString());
		expect((await t.call("GET", "/api/auth/links", { token: key })).status).toBe(401);
		expect((await link(t, key, "bob@example.com")).status).toBe(401);
		expect(
			(await t.call("POST", "/api/auth/switch", { token: key, body: { user_id: "bob" } })).status,
		).toBe(401);
		expect((await t.call("POST", "/api/auth/links/google-intent", { token: key })).status).toBe(
			401,
		);
		expect((await t.call("GET", "/api/auth/links")).status).toBe(401);
	});
});

describe("linked accounts: switch and unlink", () => {
	it("switches only between directly linked accounts and keeps the old session", async () => {
		const { t, tokens } = await setup();
		await link(t, tokens.alice!, "bob@example.com");
		await link(t, tokens.bob!, "carol@example.com");

		const ok = await t.call("POST", "/api/auth/switch", {
			token: tokens.alice!,
			body: { user_id: "bob" },
		});
		expect(ok.status).toBe(200);
		const data = ((await ok.json()) as Json).data as { token: string; user: { id: string } };
		expect(data.user.id).toBe("bob");
		expect(data.token).toStartWith("kp_");
		const me = await t.call("GET", "/api/auth/me", { token: data.token });
		expect(((await me.json()) as { data: { user: { id: string } } }).data.user.id).toBe("bob");
		// alice's own session still works
		expect((await t.call("GET", "/api/auth/links", { token: tokens.alice! })).status).toBe(200);

		// alice-carol are only linked through bob: no transitive switching
		for (const target of ["carol", "alice", "nobody", ""]) {
			const res = await t.call("POST", "/api/auth/switch", {
				token: tokens.alice!,
				body: { user_id: target },
			});
			expect(res.status).toBe(403);
		}
	});

	it("lets either side unlink, then blocks switching", async () => {
		const { t, tokens } = await setup();
		await link(t, tokens.alice!, "bob@example.com");
		const id = (await list(t, tokens.alice!))[0]!.id;

		// a stranger cannot remove it
		expect((await t.call("DELETE", `/api/auth/links/${id}`, { token: tokens.carol! })).status).toBe(
			404,
		);
		// the target side can
		expect((await t.call("DELETE", `/api/auth/links/${id}`, { token: tokens.bob! })).status).toBe(
			200,
		);
		expect(await list(t, tokens.alice!)).toEqual([]);
		const blocked = await t.call("POST", "/api/auth/switch", {
			token: tokens.alice!,
			body: { user_id: "bob" },
		});
		expect(blocked.status).toBe(403);

		// and the creator can on a fresh link
		await link(t, tokens.alice!, "bob@example.com");
		const id2 = (await list(t, tokens.alice!))[0]!.id;
		expect(
			(await t.call("DELETE", `/api/auth/links/${id2}`, { token: tokens.alice! })).status,
		).toBe(200);
		expect(await list(t, tokens.bob!)).toEqual([]);
	});
});

/** Both cookies of a Google link start, as one Cookie header. */
const cookieHeader = (res: Response): string =>
	res.headers
		.getSetCookie()
		.map((c) => c.split(";")[0])
		.join("; ");

function mockGoogle(email: string, extra: Record<string, unknown> = {}) {
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		const url = String(input);
		if (url.includes("oauth2.googleapis.com/token")) return Response.json({ access_token: "at" });
		return Response.json({ email, sub: `g-${email}`, name: "G", email_verified: true, ...extra });
	}) as typeof fetch;
}

async function startLink(t: MigratedTestApp, token: string, redirect = "http://local/settings") {
	const intentRes = await t.call("POST", "/api/auth/links/google-intent", {
		token,
		body: { current_password: PASSWORD },
	});
	expect(intentRes.status).toBe(200);
	const intent = ((await intentRes.json()) as Json).data?.intent as string;
	const start = await t.call(
		"GET",
		`/api/auth/google?link=${intent}&redirect_to=${encodeURIComponent(redirect)}`,
	);
	expect(start.status).toBe(302);
	return {
		intent,
		state: new URL(start.headers.get("location") ?? "").searchParams.get("state"),
		cookie: cookieHeader(start),
	};
}

const callback = (t: MigratedTestApp, state: string | null, cookie: string) =>
	t.call("GET", `/api/auth/google/callback?code=c&state=${state}`, { headers: { cookie } });

const codeFrom = (res: Response): string =>
	new URLSearchParams((res.headers.get("location") ?? "").split("#")[1]).get("link_code") ?? "";

describe("linked accounts: Google (two-step, owner-completed)", () => {
	it("does not link in the callback; the owner's session completes it with the code", async () => {
		const { t, tokens } = await setup();
		const { state, cookie } = await startLink(t, tokens.alice!);
		mockGoogle("bob@example.com");
		const cb = await callback(t, state, cookie);
		expect(cb.status).toBe(302);
		expect(cb.headers.get("location")).toStartWith("http://local/settings#link_code=");
		expect(await list(t, tokens.alice!)).toEqual([]);

		const code = codeFrom(cb);
		const preview = await t.call("POST", "/api/auth/links/google/preview", {
			token: tokens.alice!,
			body: { code },
		});
		expect(((await preview.json()) as Json).data).toMatchObject({
			user: { email: "bob@example.com" },
		});
		expect(await list(t, tokens.alice!)).toEqual([]);

		const done = await t.call("POST", "/api/auth/links/google/complete", {
			token: tokens.alice!,
			body: { code },
		});
		expect(done.status).toBe(201);
		expect((await list(t, tokens.alice!)).map((l) => l.user.id)).toEqual(["bob"]);
		// one-time
		const again = await t.call("POST", "/api/auth/links/google/complete", {
			token: tokens.alice!,
			body: { code },
		});
		expect(again.status).toBe(403);
	});

	it("CSRF: a victim finishing the attacker's flow cannot link the attacker to themselves", async () => {
		const { t, tokens } = await setup();
		// attacker (alice) mints an intent and lures the victim (bob) into starting it
		const { state, cookie } = await startLink(t, tokens.alice!);
		mockGoogle("bob@example.com");
		const cb = await callback(t, state, cookie);
		const code = codeFrom(cb);
		// no link exists after the victim's Google consent
		expect(await list(t, tokens.alice!)).toEqual([]);
		expect(await list(t, tokens.bob!)).toEqual([]);
		// the victim's own session cannot complete another user's flow
		const asVictim = await t.call("POST", "/api/auth/links/google/complete", {
			token: tokens.bob!,
			body: { code },
		});
		expect(asVictim.status).toBe(403);
		// a third party with the code but no owner session cannot either
		expect(
			(
				await t.call("POST", "/api/auth/links/google/complete", {
					token: tokens.carol!,
					body: { code },
				})
			).status,
		).toBe(403);
		expect(await list(t, tokens.alice!)).toEqual([]);
	});

	it("consumes the nonce at flow start and binds the flow to the starting browser", async () => {
		const { t, tokens } = await setup();
		const { intent, state, cookie } = await startLink(t, tokens.alice!);
		// replaying the nonce after start fails
		const replay = await t.call(
			"GET",
			`/api/auth/google?link=${intent}&redirect_to=${encodeURIComponent("http://local/settings")}`,
		);
		expect(replay.headers.get("location")).toBe("http://local/settings?link=error&reason=expired");
		// callback without the binding cookie (a different browser) is rejected
		mockGoogle("bob@example.com");
		const oauthOnly = cookie.split("; ").find((c) => c.startsWith("rk_oauth")) ?? "";
		const wrongBrowser = await callback(t, state, oauthOnly);
		expect(wrongBrowser.headers.get("location")).toBe(
			"http://local/settings?link=error&reason=expired",
		);
		// and with a wrong binding value
		const forged = await callback(t, state, `${oauthOnly}; rk_link_bind=forged`);
		expect(forged.headers.get("location")).toContain("reason=expired");
	});

	it("honours native redirect schemes (code in the fragment)", async () => {
		const { t, tokens } = await setup();
		const { state, cookie } = await startLink(t, tokens.alice!, "revklik://auth/callback");
		mockGoogle("bob@example.com");
		const cb = await callback(t, state, cookie);
		expect(cb.headers.get("location")).toStartWith("revklik://auth/callback#link_code=");
	});

	it("refuses unknown, self, and unverified Google targets", async () => {
		const { t, tokens } = await setup();
		for (const [email, reason] of [
			["stranger@example.com", "no_account"],
			["alice@example.com", "self"],
		] as const) {
			const { state, cookie } = await startLink(t, tokens.alice!);
			mockGoogle(email);
			const cb = await callback(t, state, cookie);
			expect(cb.headers.get("location")).toBe(`http://local/settings?link=error&reason=${reason}`);
		}
		expect(
			t.db.query("SELECT id FROM users WHERE email = 'stranger@example.com'").get(),
		).toBeNull();
		t.db.prepare("UPDATE users SET email_verified_at = NULL WHERE id = 'bob'").run();
		const { state, cookie } = await startLink(t, tokens.alice!);
		mockGoogle("bob@example.com");
		expect((await callback(t, state, cookie)).headers.get("location")).toContain(
			"reason=unverified",
		);
	});

	it("refuses an address match without email_verified=true and a different stored sub", async () => {
		const { t, tokens } = await setup();
		{
			const { state, cookie } = await startLink(t, tokens.alice!);
			mockGoogle("bob@example.com", { email_verified: undefined });
			expect((await callback(t, state, cookie)).headers.get("location")).toContain(
				"reason=no_account",
			);
		}
		t.db.prepare("UPDATE users SET google_id = 'someone-else' WHERE id = 'bob'").run();
		const { state, cookie } = await startLink(t, tokens.alice!);
		mockGoogle("bob@example.com");
		expect((await callback(t, state, cookie)).headers.get("location")).toContain(
			"reason=no_account",
		);
	});

	it("sign-in refuses an address match whose stored google_id differs, or unverified by Google", async () => {
		const { t } = await setup();
		t.db.prepare("UPDATE users SET google_id = 'someone-else' WHERE id = 'bob'").run();
		const start = await t.call("GET", "/api/auth/google");
		const state = new URL(start.headers.get("location") ?? "").searchParams.get("state");
		mockGoogle("bob@example.com");
		expect((await callback(t, state, cookieHeader(start))).status).toBe(403);

		const start2 = await t.call("GET", "/api/auth/google");
		const state2 = new URL(start2.headers.get("location") ?? "").searchParams.get("state");
		mockGoogle("carol@example.com", { email_verified: undefined });
		expect((await callback(t, state2, cookieHeader(start2))).status).toBe(403);
	});
});

describe("linked accounts: account takeover hardening", () => {
	it("a password reset removes the user's links, intents and switch sessions", async () => {
		const { t, tokens } = await setup();
		await link(t, tokens.alice!, "bob@example.com");
		const sw = await t.call("POST", "/api/auth/switch", {
			token: tokens.alice!,
			body: { user_id: "bob" },
		});
		const bobViaAlice = ((await sw.json()) as Json).data?.token as string;
		await t.call("POST", "/api/auth/links/google-intent", {
			token: tokens.bob!,
			body: { current_password: PASSWORD },
		});
		const reset = "reset-token-1";
		t.db
			.prepare(
				"INSERT INTO password_resets (id, user_id, token_hash, expires_at, created_at) VALUES ('r1','alice',?,?,?)",
			)
			.run(
				await hashToken(reset),
				new Date(Date.now() + 60_000).toISOString(),
				new Date().toISOString(),
			);
		const res = await t.call("POST", "/api/auth/reset-password", {
			body: { token: reset, password: "brand-new-pass" },
		});
		expect(res.status).toBe(200);
		const n = (sql: string) => (t.db.query(sql).get() as { n: number }).n;
		expect(n("SELECT COUNT(*) AS n FROM account_links")).toBe(0);
		// the session alice minted into bob dies with the recovery
		expect((await t.call("GET", "/api/auth/links", { token: bobViaAlice })).status).toBe(401);
		// bob's own login session is untouched
		expect((await t.call("GET", "/api/auth/links", { token: tokens.bob! })).status).toBe(200);
	});

	it("Google takeover of an unverified account removes its links", async () => {
		const { t } = await setup();
		t.db.prepare("UPDATE users SET email_verified_at = NULL WHERE id = 'bob'").run();
		t.db
			.prepare(
				"INSERT INTO account_links (id, user_a, user_b, created_at, created_by) VALUES ('l1','alice','bob',?,?)",
			)
			.run(new Date().toISOString(), "alice");
		const start = await t.call("GET", "/api/auth/google");
		const state = new URL(start.headers.get("location") ?? "").searchParams.get("state");
		mockGoogle("bob@example.com");
		expect((await callback(t, state, cookieHeader(start))).status).toBe(302);
		expect((t.db.query("SELECT COUNT(*) AS n FROM account_links").get() as { n: number }).n).toBe(
			0,
		);
	});

	it("refuses unverified link targets", async () => {
		const { t, tokens } = await setup();
		t.db.prepare("UPDATE users SET email_verified_at = NULL WHERE id = 'bob'").run();
		const res = await link(t, tokens.alice!, "bob@example.com");
		expect(res.status).toBe(403);
		expect(((await res.json()) as Json).error).toBe("unverified");
	});

	it("requires the current account's password to start a link", async () => {
		const { t, tokens } = await setup();
		const none = await t.call("POST", "/api/auth/links", {
			token: tokens.alice!,
			body: { email: "bob@example.com", password: PASSWORD },
		});
		expect(none.status).toBe(403);
		expect(((await none.json()) as Json).error).toBe("current_password_invalid");
		expect((await link(t, tokens.alice!, "bob@example.com", PASSWORD, "wrong-wrong")).status).toBe(
			403,
		);
		expect(
			(await t.call("POST", "/api/auth/links/google-intent", { token: tokens.alice!, body: {} }))
				.status,
		).toBe(403);
		expect(await list(t, tokens.alice!)).toEqual([]);
	});

	it("Google-only accounts need a session minted in the last 10 minutes", async () => {
		const { t, tokens } = await setup();
		t.db.prepare("UPDATE users SET password_hash = '' WHERE id = 'alice'").run();
		const fresh = await t.call("POST", "/api/auth/links/google-intent", {
			token: tokens.alice!,
			body: {},
		});
		expect(fresh.status).toBe(200);
		t.db
			.prepare("UPDATE api_keys SET created_at = ? WHERE user_id = 'alice'")
			.run(new Date(Date.now() - 11 * 60_000).toISOString());
		const stale = await t.call("POST", "/api/auth/links/google-intent", {
			token: tokens.alice!,
			body: {},
		});
		expect(stale.status).toBe(403);
		expect(((await stale.json()) as Json).error).toBe("recent_login_required");
	});

	it("tags switch sessions and revokes them when the link is removed", async () => {
		const { t, tokens } = await setup();
		await link(t, tokens.alice!, "bob@example.com");
		const sw = await t.call("POST", "/api/auth/switch", {
			token: tokens.alice!,
			body: { user_id: "bob" },
		});
		const minted = ((await sw.json()) as Json).data?.token as string;
		const row = t.db
			.query("SELECT name FROM api_keys WHERE key_hash = ?")
			.get(await hashToken(minted)) as { name: string };
		expect(row.name).toBe("switch:alice");
		expect((await t.call("GET", "/api/auth/links", { token: minted })).status).toBe(200);
		const id = (await list(t, tokens.alice!))[0]!.id;
		await t.call("DELETE", `/api/auth/links/${id}`, { token: tokens.bob! });
		expect((await t.call("GET", "/api/auth/links", { token: minted })).status).toBe(401);
		expect((await t.call("GET", "/api/auth/links", { token: tokens.bob! })).status).toBe(200);
	});

	it("emails both accounts when a link is created", async () => {
		const sent: { to: string }[] = [];
		const t = await createMigratedTestApp({
			EMAIL: { send: async (m: { to: string }) => void sent.push(m) },
		});
		const hash = await hashPassword(PASSWORD);
		const tok = await t.seedUser({ id: "alice" });
		await t.seedUser({ id: "bob" });
		t.db
			.prepare("UPDATE users SET password_hash = ?, email_verified_at = ?")
			.run(hash, new Date().toISOString());
		expect((await link(t, tok, "bob@example.com")).status).toBe(201);
		await settleWaitUntil();
		expect(sent.map((m) => m.to).toSorted()).toEqual(["alice@example.com", "bob@example.com"]);
	});

	it("link password failures spend the login-email budget", async () => {
		const { t, tokens } = await setup();
		t.db
			.prepare("INSERT INTO login_attempts (key, count, window_start) VALUES (?, 29, ?)")
			.run("login-email:bob@example.com", new Date().toISOString());
		expect((await link(t, tokens.alice!, "bob@example.com", "nope-nope")).status).toBe(401);
		const login = await t.call("POST", "/api/auth/login", {
			body: { email: "bob@example.com", password: PASSWORD },
		});
		expect(login.status).toBe(429);
	});
});
