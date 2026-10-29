import { afterEach, describe, expect, it } from "bun:test";
import { MAX_ACCOUNT_LINKS } from "../lib/account-links";
import { createMigratedTestApp, type MigratedTestApp } from "../lib/test-harness";
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
		t.db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, id);
	}
	return { t, tokens };
}

const link = (t: MigratedTestApp, token: string, email: string, password = PASSWORD) =>
	t.call("POST", "/api/auth/links", { token, body: { email, password } });

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
			t.db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, `extra${i}`);
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

describe("linked accounts: Google", () => {
	function mockGoogle(email: string, sub = `g-${email}`) {
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes("oauth2.googleapis.com/token")) return Response.json({ access_token: "at" });
			return Response.json({ email, sub, name: "G", email_verified: true });
		}) as typeof fetch;
	}

	async function startLink(t: MigratedTestApp, token: string, redirect: string) {
		const intentRes = await t.call("POST", "/api/auth/links/google-intent", { token });
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
			cookie: (start.headers.get("set-cookie") ?? "").split(";")[0] ?? "",
		};
	}

	it("links the current user to the existing Google account without signing in", async () => {
		const { t, tokens } = await setup();
		t.db.prepare("UPDATE users SET google_id = 'g-bob@example.com' WHERE id = 'bob'").run();
		const { state, cookie } = await startLink(t, tokens.alice!, "http://local/settings");
		mockGoogle("bob@example.com");
		const cb = await t.call("GET", `/api/auth/google/callback?code=c&state=${state}`, {
			headers: { cookie },
		});
		expect(cb.status).toBe(302);
		const loc = cb.headers.get("location") ?? "";
		expect(loc).toBe("http://local/settings?link=ok");
		expect(loc).not.toContain("token");
		expect((await list(t, tokens.alice!)).map((l) => l.user.id)).toEqual(["bob"]);
		// intent is single use: replaying the same cookie+state fails
		const replay = await t.call("GET", `/api/auth/google/callback?code=c&state=${state}`, {
			headers: { cookie },
		});
		expect(replay.headers.get("location") ?? "").toContain("link=error");
	});

	it("honours native redirect schemes", async () => {
		const { t, tokens } = await setup();
		const { state, cookie } = await startLink(t, tokens.alice!, "revklik://settings");
		mockGoogle("bob@example.com");
		const cb = await t.call("GET", `/api/auth/google/callback?code=c&state=${state}`, {
			headers: { cookie },
		});
		expect(cb.headers.get("location")).toBe("revklik://settings?link=ok");
	});

	it("refuses an unknown Google user and creates nothing", async () => {
		const { t, tokens } = await setup();
		const { state, cookie } = await startLink(t, tokens.alice!, "http://local/settings");
		mockGoogle("stranger@example.com");
		const cb = await t.call("GET", `/api/auth/google/callback?code=c&state=${state}`, {
			headers: { cookie },
		});
		expect(cb.headers.get("location")).toBe("http://local/settings?link=error&reason=no_account");
		expect(
			t.db.query("SELECT id FROM users WHERE email = 'stranger@example.com'").get(),
		).toBeNull();
		expect(await list(t, tokens.alice!)).toEqual([]);
	});

	it("refuses linking to yourself via Google", async () => {
		const { t, tokens } = await setup();
		const { state, cookie } = await startLink(t, tokens.alice!, "http://local/settings");
		mockGoogle("alice@example.com");
		const cb = await t.call("GET", `/api/auth/google/callback?code=c&state=${state}`, {
			headers: { cookie },
		});
		expect(cb.headers.get("location")).toBe("http://local/settings?link=error&reason=self");
	});

	it("rejects a forged or expired intent at start and at callback", async () => {
		const { t, tokens } = await setup();
		const forged = await t.call(
			"GET",
			`/api/auth/google?link=deadbeef&redirect_to=${encodeURIComponent("http://local/settings")}`,
		);
		expect(forged.headers.get("location")).toBe("http://local/settings?link=error&reason=expired");

		const { state, cookie, intent } = await startLink(t, tokens.alice!, "http://local/settings");
		t.db
			.prepare("UPDATE account_link_intents SET expires_at = ? WHERE token_hash = ?")
			.run(new Date(Date.now() - 1000).toISOString(), await hashToken(intent));
		mockGoogle("bob@example.com");
		const cb = await t.call("GET", `/api/auth/google/callback?code=c&state=${state}`, {
			headers: { cookie },
		});
		expect(cb.headers.get("location")).toBe("http://local/settings?link=error&reason=expired");
		expect(await list(t, tokens.alice!)).toEqual([]);
	});
});
