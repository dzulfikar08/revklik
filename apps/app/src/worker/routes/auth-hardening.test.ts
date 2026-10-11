import { afterEach, describe, expect, it } from "bun:test";
import { createDb } from "../db";
import { recordReferralSignup } from "../lib/affiliates";
import { createMigratedTestApp, type MigratedTestApp } from "../lib/test-harness";
import { generateApiKey, hashToken, verifyPassword } from "../utils";

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

async function legacyHash(password: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password));
	return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

const login = (t: MigratedTestApp, email: string, password: string, ip = "1.1.1.1") =>
	t.call("POST", "/api/auth/login", {
		body: { email, password },
		headers: { "cf-connecting-ip": ip },
	});

describe("passwords (DEV-34)", () => {
	it("stores salted PBKDF2 and verifies it", async () => {
		const t = await createMigratedTestApp();
		const res = await t.call("POST", "/api/auth/register", {
			body: { name: "A", email: "  Alice@Example.COM ", password: "correct-horse" },
		});
		expect(res.status).toBe(201);
		const row = t.db.query("SELECT email, password_hash FROM users").get() as {
			email: string;
			password_hash: string;
		};
		expect(row.email).toBe("alice@example.com");
		expect(row.password_hash).toMatch(/^pbkdf2\$100000\$[^$]+\$[^$]+$/);
		expect((await verifyPassword("correct-horse", row.password_hash)).ok).toBe(true);
		expect((await verifyPassword("wrong", row.password_hash)).ok).toBe(false);

		const dup = await t.call("POST", "/api/auth/register", {
			body: { name: "A2", email: "ALICE@example.com", password: "correct-horse" },
		});
		expect(dup.status).toBe(409);
		const short = await t.call("POST", "/api/auth/register", {
			body: { name: "B", email: "b@example.com", password: "short" },
		});
		expect(short.status).toBe(400);
	});

	it("legacy SHA-256 users log in case-insensitively and are re-hashed", async () => {
		const t = await createMigratedTestApp();
		t.db
			.prepare("INSERT INTO users (id, email, password_hash, name) VALUES (?,?,?,?)")
			.run("u-legacy", "Legacy@Example.com", await legacyHash("old-password"), "L");
		const res = await login(t, "legacy@example.com", "old-password");
		expect(res.status).toBe(200);
		const row = t.db.query("SELECT password_hash FROM users WHERE id = 'u-legacy'").get() as {
			password_hash: string;
		};
		expect(row.password_hash.startsWith("pbkdf2$")).toBe(true);
		expect((await login(t, "LEGACY@example.com", "old-password")).status).toBe(200);
	});

	it("throttles repeated failures per IP + email", async () => {
		const t = await createMigratedTestApp();
		await t.call("POST", "/api/auth/register", {
			body: { name: "R", email: "rl@example.com", password: "right-password" },
		});
		for (let i = 0; i < 10; i++) {
			expect((await login(t, "rl@example.com", "nope", "9.9.9.9")).status).toBe(401);
		}
		expect((await login(t, "rl@example.com", "right-password", "9.9.9.9")).status).toBe(429);
		expect((await login(t, "rl@example.com", "right-password", "8.8.8.8")).status).toBe(200);
	});
});

describe("sessions and tokens (DEV-34)", () => {
	it("sessions expire after 30 days; account tokens cannot use the dashboard API", async () => {
		const t = await createMigratedTestApp();
		const reg = await t.call("POST", "/api/auth/register", {
			body: { name: "S", email: "s@example.com", password: "password-1" },
		});
		const { data } = (await reg.json()) as { data: { token: string; user: { id: string } } };
		const row = t.db
			.query("SELECT expires_at FROM api_keys WHERE key_hash = ?")
			.get(await hashToken(data.token)) as { expires_at: string };
		const days = (Date.parse(row.expires_at) - Date.now()) / 86_400_000;
		expect(days).toBeGreaterThan(29.9);
		expect((await t.call("GET", "/api/sites", { token: data.token })).status).toBe(200);

		const { key } = generateApiKey("account");
		t.db
			.prepare(
				"INSERT INTO api_keys (id, user_id, key_hash, key_prefix, name, token_type, created_at) VALUES (?,?,?,?,?,?,?)",
			)
			.run("k-acct", data.user.id, await hashToken(key), "rvt_", "cli", "account", "2026-01-01");
		expect((await t.call("GET", "/api/sites", { token: key })).status).toBe(401);

		t.db
			.prepare("UPDATE api_keys SET expires_at = ? WHERE key_hash = ?")
			.run(new Date(Date.now() - 1000).toISOString(), await hashToken(data.token));
		expect((await t.call("GET", "/api/sites", { token: data.token })).status).toBe(401);
	});
});

describe("password reset (DEV-34)", () => {
	it("emails a single-use link, sets the password and signs out sessions", async () => {
		const sent: { to: string; subject: string; text?: string }[] = [];
		const t = await createMigratedTestApp({
			EMAIL: {
				send: async (m: { to: string; subject: string; text?: string }) => {
					if (m.subject.includes("reset")) sent.push(m);
				},
			},
			APP_URL: "https://app.test",
		});
		const reg = await t.call("POST", "/api/auth/register", {
			body: { name: "P", email: "p@example.com", password: "first-password" },
		});
		const { data } = (await reg.json()) as { data: { token: string } };

		const unknown = await t.call("POST", "/api/auth/forgot-password", {
			body: { email: "nobody@example.com" },
		});
		expect((await unknown.json()) as Record<string, unknown>).toEqual({ success: true });
		expect(sent.length).toBe(0);

		const known = await t.call("POST", "/api/auth/forgot-password", {
			body: { email: "P@example.com" },
		});
		expect((await known.json()) as Record<string, unknown>).toEqual({ success: true });
		await new Promise((r) => setTimeout(r, 10));
		expect(sent.length).toBe(1);
		const token = /reset-password\?token=([0-9a-f]+)/.exec(sent[0]?.text ?? "")?.[1] ?? "";
		expect(sent[0]?.text).toContain("https://app.test/reset-password?token=");
		expect(
			(t.db.query("SELECT token_hash FROM password_resets").get() as { token_hash: string })
				.token_hash,
		).toBe(await hashToken(token));

		const reset = await t.call("POST", "/api/auth/reset-password", {
			body: { token, password: "second-password" },
		});
		expect((await reset.json()) as Record<string, unknown>).toEqual({ success: true });
		expect((await t.call("GET", "/api/sites", { token: data.token })).status).toBe(401);
		expect((await login(t, "p@example.com", "second-password")).status).toBe(200);
		expect((await login(t, "p@example.com", "first-password")).status).toBe(401);

		const reuse = await t.call("POST", "/api/auth/reset-password", {
			body: { token, password: "third-password" },
		});
		expect(reuse.status).toBe(400);
	});
});

describe("Google OAuth state (DEV-34)", () => {
	function mockGoogle(email: string) {
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes("oauth2.googleapis.com/token")) return Response.json({ access_token: "at" });
			return Response.json({ email, sub: `g-${email}`, name: "G" });
		}) as typeof fetch;
	}

	it("rejects a callback whose state does not match the cookie", async () => {
		const t = await createMigratedTestApp();
		mockGoogle("g1@example.com");
		const res = await t.call("GET", "/api/auth/google/callback?code=c&state=forged");
		expect(res.status).toBe(400);
	});

	it("completes with the cookie, credits ?ref and honours a native redirect_to", async () => {
		const t = await createMigratedTestApp();
		await t.seedUser({ id: "u-aff" });
		t.db
			.prepare(
				"INSERT INTO affiliates (id, user_id, referral_code, commission_rate, status) VALUES ('a1','u-aff','REFCODE1',0.2,'active')",
			)
			.run();
		const start = await t.call(
			"GET",
			"/api/auth/google?ref=REFCODE1&redirect_to=revklik-new%3A%2F%2Fauth%2Fcallback",
		);
		expect(start.status).toBe(302);
		const state = new URL(start.headers.get("location") ?? "").searchParams.get("state");
		const cookie = (start.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
		mockGoogle("New.Google@Example.com");
		const cb = await t.call("GET", `/api/auth/google/callback?code=c&state=${state}`, {
			headers: { cookie },
		});
		expect(cb.status).toBe(302);
		expect(cb.headers.get("location")).toMatch(/^revklik-new:\/\/auth\/callback#token=kp_/);
		const user = t.db
			.query("SELECT id, email FROM users WHERE email = ?")
			.get("new.google@example.com") as { id: string };
		expect(user).toBeTruthy();
		const referral = t.db
			.query("SELECT affiliate_id FROM referrals WHERE referred_user_id = ?")
			.get(user.id) as { affiliate_id: string };
		expect(referral.affiliate_id).toBe("a1");

		const evil = await t.call("GET", "/api/auth/google?redirect_to=https%3A%2F%2Fevil.example");
		const evilCookie = decodeURIComponent(
			(evil.headers.get("set-cookie") ?? "").split(";")[0]?.split("=")[1] ?? "",
		);
		expect(atob(evilCookie)).not.toContain("evil");
	});
});

describe("affiliates (DEV-34)", () => {
	it("register accepts ref in the body, QRIS payments pay commission once, self-referral is ignored", async () => {
		const t = await createMigratedTestApp({ PAKASIR_API_KEY: "k" });
		await t.seedUser({ id: "u-ref-owner" });
		t.db
			.prepare(
				"INSERT INTO affiliates (id, user_id, referral_code, commission_rate, status) VALUES ('a2','u-ref-owner','OWNERREF',0.2,'active')",
			)
			.run();
		expect(await recordReferralSignup(createDb(t.d1), "OWNERREF", "u-ref-owner")).toBe(false);

		const reg = await t.call("POST", "/api/auth/register", {
			body: { name: "R", email: "referred@example.com", password: "password-1", ref: "ownerref" },
		});
		const { data } = (await reg.json()) as { data: { token: string; user: { id: string } } };
		const checkout = await t.call("POST", "/api/billing/checkout/pakasir", {
			token: data.token,
			body: { plan: "starter" },
		});
		const order = ((await checkout.json()) as { data: { order_id: string } }).data.order_id;
		globalThis.fetch = (async () =>
			Response.json({
				transaction: { amount: 64_000, order_id: order, status: "completed" },
			})) as unknown as typeof fetch;
		const payload = { amount: 64_000, order_id: order, project: "revklik", status: "completed" };
		await t.call("POST", "/api/webhooks/pakasir", { body: payload });
		await t.call("POST", "/api/webhooks/pakasir", { body: payload });

		const rows = t.db
			.query(
				"SELECT event, commission_amount FROM referrals WHERE referred_user_id = ? ORDER BY event",
			)
			.all(data.user.id) as { event: string; commission_amount: number }[];
		expect(rows.map((r) => r.event)).toEqual(["payment", "signup"]);
		// 64,000 IDR at 16,000/USD = $4 -> 20% = $0.80
		expect(rows[0]?.commission_amount).toBeCloseTo(0.8);
		const aff = t.db.query("SELECT total_earned FROM affiliates WHERE id = 'a2'").get() as {
			total_earned: number;
		};
		expect(aff.total_earned).toBeCloseTo(0.8);
	});
});

describe("sites list (contract)", () => {
	it("reports has_events per site", async () => {
		const t = await createMigratedTestApp();
		const token = await t.seedUser({ id: "u-he", plan: "growth", withSite: "s-he-live" });
		t.db
			.prepare("INSERT INTO sites (id, user_id, name, domain, created_at) VALUES (?,?,?,?,?)")
			.run("s-he-new", "u-he", "new", "new.example.com", new Date().toISOString());
		t.db
			.prepare(
				"INSERT INTO events (id, site_id, session_id, visitor_id, timestamp, path) VALUES ('e-he','s-he-live','s','v','2020-01-01T00:00:00Z','/')",
			)
			.run();
		const res = await t.call("GET", "/api/sites", { token });
		const { data } = (await res.json()) as { data: { id: string; has_events: boolean }[] };
		const byId = Object.fromEntries(data.map((s) => [s.id, s.has_events]));
		expect(byId).toEqual({ "s-he-live": true, "s-he-new": false });
	});
});
