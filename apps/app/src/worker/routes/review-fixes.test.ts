import { afterEach, describe, expect, it } from "bun:test";
import { createDb } from "../db";
import { usageMonth } from "../lib/account-usage";
import { PURGE_CHUNK, purgeExpiredRows, purgeSiteRows } from "../lib/purge";
import { signStandardWebhook } from "../lib/standard-webhooks";
import { clearSubscriptionCaches, enforceSiteQuota } from "../lib/subscription-cache";
import { createMigratedTestApp, makeD1, type MigratedTestApp } from "../lib/test-harness";
import { verifyStripeSignature } from "../lib/webhook-utils";
import { migrateDatabase } from "../migrations";
import { generateApiKey, hashToken } from "../utils";

const DAY = 86_400_000;
const BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36";
const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

async function hmacHex(key: string, message: string): Promise<string> {
	const k = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(key),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(message));
	return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function polarDelivery(body: unknown, secret: string) {
	const raw = JSON.stringify(body);
	const id = crypto.randomUUID();
	const ts = String(Math.floor(Date.now() / 1000));
	return {
		body: raw,
		headers: {
			"content-type": "application/json",
			"webhook-id": id,
			"webhook-timestamp": ts,
			"webhook-signature": await signStandardWebhook(raw, id, ts, secret),
		},
	};
}

const sub = (t: MigratedTestApp, userId: string) =>
	t.db
		.query(
			"SELECT plan, status, current_period_end, polar_subscription_id FROM subscriptions WHERE user_id = ?",
		)
		.get(userId) as {
		plan: string;
		status: string;
		current_period_end: string;
		polar_subscription_id: string | null;
	};

describe("Stripe signatures (review #1)", () => {
	const secret = "whsec_test_5f3c9b2a1d7e";
	const payload = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });

	it("verifies a signature computed the way Stripe documents (UTF-8 secret, t.payload)", async () => {
		const t = Math.floor(Date.now() / 1000);
		const good = await hmacHex(secret, `${t}.${payload}`);
		expect(await verifyStripeSignature(payload, `t=${t},v1=${good}`, secret)).toBe(true);
		// any of several v1 entries may match (secret rotation)
		expect(
			await verifyStripeSignature(payload, `t=${t},v1=${"0".repeat(64)},v1=${good}`, secret),
		).toBe(true);
		expect(await verifyStripeSignature(`${payload} `, `t=${t},v1=${good}`, secret)).toBe(false);
	});

	it("rejects stale timestamps and never throws on garbage", async () => {
		const old = Math.floor(Date.now() / 1000) - 600;
		const sig = await hmacHex(secret, `${old}.${payload}`);
		expect(await verifyStripeSignature(payload, `t=${old},v1=${sig}`, secret)).toBe(false);
		expect(await verifyStripeSignature(payload, "%%%,,,=", "not-base64-!!")).toBe(false);
		expect(await verifyStripeSignature(payload, "", secret)).toBe(false);
	});

	it("the Stripe route records a correctly signed checkout", async () => {
		const t = await createMigratedTestApp();
		await t.seedUser({ id: "u-stripe", withSite: "s-stripe" });
		t.db
			.prepare(
				"INSERT INTO payment_providers (id, site_id, provider, config, enabled) VALUES ('ist','s-stripe','stripe',?,1)",
			)
			.run(JSON.stringify({ webhook_secret: secret }));
		const body = JSON.stringify({
			type: "checkout.session.completed",
			data: {
				object: {
					id: "cs_1",
					amount_total: 2500,
					currency: "usd",
					metadata: { revklik_site_id: "s-stripe" },
				},
			},
		});
		const ts = Math.floor(Date.now() / 1000);
		const res = await t.call("POST", "/api/webhooks/stripe", {
			body,
			headers: {
				"content-type": "application/json",
				"Stripe-Signature": `t=${ts},v1=${await hmacHex(secret, `${ts}.${body}`)}`,
			},
		});
		expect(res.status).toBe(200);
		const row = t.db.query("SELECT revenue FROM events WHERE site_id = 's-stripe'").get() as {
			revenue: number;
		};
		expect(row.revenue).toBe(25);
	});
});

describe("customer Polar webhook secret (review #2)", () => {
	it("RevKlik's env secret no longer authenticates customer-site deliveries", async () => {
		const t = await createMigratedTestApp({ POLAR_WEBHOOK_SECRET: "revklik-billing" });
		await t.seedUser({ id: "u-pe", withSite: "s-pe" });
		const delivery = await polarDelivery(
			{
				type: "order.created",
				data: { id: "o1", amount: 100, metadata: { revklik_site_id: "s-pe" } },
			},
			"revklik-billing",
		);
		expect((await t.call("POST", "/api/webhooks/polar", delivery)).status).toBe(401);
	});
});

describe("Polar billing lifecycle (review #3, #4)", () => {
	const SECRET = "polar_whs_review";

	it("events for another subscription id leave the row alone", async () => {
		const t = await createMigratedTestApp({ POLAR_WEBHOOK_SECRET: SECRET });
		await t.seedUser({ id: "u-own-sub", plan: "growth" });
		t.db.exec(
			"UPDATE subscriptions SET polar_subscription_id = 'sub_live' WHERE user_id = 'u-own-sub'",
		);
		const before = sub(t, "u-own-sub");
		for (const type of ["subscription.updated", "subscription.canceled", "subscription.revoked"]) {
			const res = await t.call(
				"POST",
				"/api/billing/webhook",
				await polarDelivery(
					{ type, data: { id: "sub_old", status: "canceled", metadata: { user_id: "u-own-sub" } } },
					SECRET,
				),
			);
			expect(res.status).toBe(200);
		}
		expect(sub(t, "u-own-sub")).toEqual(before);
	});

	it("revoking a Polar subscription never cuts a QRIS-paid period", async () => {
		const t = await createMigratedTestApp({ POLAR_WEBHOOK_SECRET: SECRET });
		await t.seedUser({ id: "u-qris-polar", plan: "starter" });
		const paidUntil = new Date(Date.now() + 25 * DAY).toISOString();
		t.db
			.prepare(
				"UPDATE subscriptions SET polar_subscription_id = 'sub_p', pakasir_paid_until = ?, current_period_end = ? WHERE user_id = 'u-qris-polar'",
			)
			.run(paidUntil, paidUntil);
		await t.call(
			"POST",
			"/api/billing/webhook",
			await polarDelivery(
				{
					type: "subscription.revoked",
					data: { id: "sub_p", metadata: { user_id: "u-qris-polar" } },
				},
				SECRET,
			),
		);
		expect(sub(t, "u-qris-polar")).toMatchObject({
			status: "active",
			current_period_end: paidUntil,
			polar_subscription_id: null,
		});
	});

	it("unmatched users are acknowledged and ignored; unverified emails do not match", async () => {
		const t = await createMigratedTestApp({ POLAR_WEBHOOK_SECRET: SECRET });
		await t.seedUser({ id: "u-squat", email: "victim@example.com" });
		const res = await t.call(
			"POST",
			"/api/billing/webhook",
			await polarDelivery(
				{
					type: "subscription.active",
					data: { id: "sub_x", status: "active", customer: { email: "victim@example.com" } },
				},
				SECRET,
			),
		);
		expect(res.status).toBe(200);
		expect(((await res.json()) as { ignored?: boolean }).ignored).toBe(true);
		expect(t.db.query("SELECT id FROM subscriptions WHERE user_id = 'u-squat'").get()).toBeNull();
	});
});

describe("account protection (review #5, #6, #7, A)", () => {
	const login = (t: MigratedTestApp, email: string, password: string, ip: string) =>
		t.call("POST", "/api/auth/login", {
			body: { email, password },
			headers: { "cf-connecting-ip": ip },
		});

	it("caps failures per email across IPs", async () => {
		const t = await createMigratedTestApp();
		await t.call("POST", "/api/auth/register", {
			body: { name: "D", email: "dist@example.com", password: "real-password" },
		});
		for (let i = 0; i < 30; i++) await login(t, "dist@example.com", "nope", `10.0.0.${i}`);
		expect((await login(t, "dist@example.com", "real-password", "10.9.9.9")).status).toBe(429);
	});

	it("verifies email through the emailed link; /auth/me reports it", async () => {
		const mails: { subject: string; text?: string }[] = [];
		const t = await createMigratedTestApp({
			EMAIL: { send: async (m: { subject: string; text?: string }) => void mails.push(m) },
			APP_URL: "https://app.test",
		});
		const reg = await t.call("POST", "/api/auth/register", {
			body: { name: "V", email: "v@example.com", password: "password-1" },
		});
		const { data } = (await reg.json()) as { data: { token: string } };
		await new Promise((r) => setTimeout(r, 10));
		const me = async () =>
			(
				(await (await t.call("GET", "/api/auth/me", { token: data.token })).json()) as {
					data: { user: { email_verified: boolean } };
				}
			).data.user.email_verified;
		expect(await me()).toBe(false);

		const link = mails.find((m) => /confirm/i.test(m.subject))?.text ?? "";
		expect(link).toContain("https://app.test/verify-email?token=");
		const token = /token=([0-9a-f]+)/.exec(link)?.[1] ?? "";
		expect((await t.call("POST", "/api/auth/verify-email", { body: { token } })).status).toBe(200);
		expect(await me()).toBe(true);
		const reuse = await t.call("POST", "/api/auth/verify-email", { body: { token } });
		expect(((await reuse.json()) as { error: string }).error).toBe("invalid_token");

		const resend = await t.call("POST", "/api/auth/resend-verification", { token: data.token });
		expect(
			((await resend.json()) as { data: { already_verified: boolean } }).data.already_verified,
		).toBe(true);
	});

	it("expired verification tokens say so; resend is limited to 3 per hour", async () => {
		const t = await createMigratedTestApp();
		const reg = await t.call("POST", "/api/auth/register", {
			body: { name: "E", email: "e@example.com", password: "password-1" },
		});
		const { data } = (await reg.json()) as { data: { token: string; user: { id: string } } };
		t.db
			.prepare(
				"INSERT INTO email_verifications (id, user_id, token_hash, expires_at) VALUES ('ev-old', ?, ?, ?)",
			)
			.run(data.user.id, await hashToken("deadbeef"), new Date(Date.now() - 1000).toISOString());
		const expired = await t.call("POST", "/api/auth/verify-email", { body: { token: "deadbeef" } });
		expect(((await expired.json()) as { error: string }).error).toBe("expired");

		for (let i = 0; i < 3; i++) {
			const r = await t.call("POST", "/api/auth/resend-verification", { token: data.token });
			expect(r.status).toBe(200);
		}
		const limited = await t.call("POST", "/api/auth/resend-verification", { token: data.token });
		expect(limited.status).toBe(429);
	});

	it("Google sign-in takes over an unverified password account and wipes its credentials", async () => {
		const t = await createMigratedTestApp();
		const reg = await t.call("POST", "/api/auth/register", {
			body: { name: "Squatter", email: "owner@example.com", password: "squatter-pw" },
		});
		const { data } = (await reg.json()) as { data: { token: string } };

		const start = await t.call("GET", "/api/auth/google");
		const state = new URL(start.headers.get("location") ?? "").searchParams.get("state");
		const cookie = (start.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
		globalThis.fetch = (async (input: RequestInfo | URL) =>
			String(input).includes("token")
				? Response.json({ access_token: "at" })
				: Response.json({
						email: "owner@example.com",
						email_verified: true,
						sub: "g-owner",
					})) as typeof fetch;
		const cb = await t.call("GET", `/api/auth/google/callback?code=c&state=${state}`, {
			headers: { cookie },
		});
		expect(cb.status).toBe(302);

		expect((await t.call("GET", "/api/sites", { token: data.token })).status).toBe(401);
		const row = t.db
			.query("SELECT password_hash, google_id, email_verified_at FROM users WHERE email = ?")
			.get("owner@example.com") as {
			password_hash: string;
			google_id: string;
			email_verified_at: string | null;
		};
		expect(row).toMatchObject({ password_hash: "", google_id: "g-owner" });
		expect(row.email_verified_at).not.toBeNull();
		const pw = await t.call("POST", "/api/auth/login", {
			body: { email: "owner@example.com", password: "squatter-pw" },
		});
		expect(pw.status).toBe(401);
	});

	it("password reset deletes API tokens and every other outstanding reset", async () => {
		const mails: { subject: string; text?: string }[] = [];
		const t = await createMigratedTestApp({
			EMAIL: { send: async (m: { subject: string; text?: string }) => void mails.push(m) },
		});
		const reg = await t.call("POST", "/api/auth/register", {
			body: { name: "T", email: "tok@example.com", password: "password-1" },
		});
		const { data } = (await reg.json()) as { data: { user: { id: string } } };
		const { key } = generateApiKey("account");
		t.db
			.prepare(
				"INSERT INTO api_keys (id, user_id, key_hash, key_prefix, name, token_type) VALUES ('k-rvt', ?, ?, 'rvt_', 'cli', 'account')",
			)
			.run(data.user.id, await hashToken(key));
		for (let i = 0; i < 2; i++) {
			await t.call("POST", "/api/auth/forgot-password", { body: { email: "tok@example.com" } });
		}
		await new Promise((r) => setTimeout(r, 10));
		const token =
			/reset-password\?token=([0-9a-f]+)/.exec(
				mails.filter((m) => m.subject.includes("reset"))[0]?.text ?? "",
			)?.[1] ?? "";
		await t.call("POST", "/api/auth/reset-password", { body: { token, password: "new-password" } });
		const left = (sql: string) => (t.db.query(sql).get(data.user.id) as { n: number }).n;
		expect(left("SELECT COUNT(*) AS n FROM api_keys WHERE user_id = ?")).toBe(0);
		expect(
			left("SELECT COUNT(*) AS n FROM password_resets WHERE user_id = ? AND used_at IS NULL"),
		).toBe(0);
	});
});

describe("migrations and ingest safety (review #8)", () => {
	it("an isolate that loses the migration lock skips without stamping", async () => {
		const t = await createMigratedTestApp();
		t.db.exec("UPDATE schema_version SET version = 1");
		t.db
			.prepare("INSERT INTO migration_lock (id, token, locked_at) VALUES (1, 'other', ?)")
			.run(new Date().toISOString());
		const d1 = makeD1(t.db) as unknown as D1Database;
		await migrateDatabase(d1, { lockWaitMs: 300 });
		expect(
			(t.db.query("SELECT version FROM schema_version").get() as { version: number }).version,
		).toBe(1);
		// a stale lock is taken over
		t.db.exec("UPDATE migration_lock SET locked_at = '2000-01-01T00:00:00Z'");
		await migrateDatabase(d1);
		expect(
			(t.db.query("SELECT version FROM schema_version").get() as { version: number }).version,
		).toBeGreaterThan(1);
	});

	it("quota enforcement fails open when the DB errors", async () => {
		clearSubscriptionCaches();
		const broken = createDb({
			prepare: () => {
				throw new Error("D1 down");
			},
		} as unknown as D1Database);
		const res = await enforceSiteQuota(broken, "s-any");
		expect(res.allowed).toBe(true);
	});

	it("Pakasir webhook adopts a legacy order recorded only on the subscription", async () => {
		const t = await createMigratedTestApp({ PAKASIR_API_KEY: "k" });
		await t.seedUser({ id: "u-legacy-qris", plan: "starter", status: "pending" });
		t.db.exec(
			"UPDATE subscriptions SET pakasir_order_id = 'RVK-legacy-1' WHERE user_id = 'u-legacy-qris'",
		);
		globalThis.fetch = (async () =>
			Response.json({
				transaction: { amount: 64_000, order_id: "RVK-legacy-1", status: "completed" },
			})) as unknown as typeof fetch;
		const res = await t.call("POST", "/api/webhooks/pakasir", {
			body: { amount: 64_000, order_id: "RVK-legacy-1", project: "revklik", status: "completed" },
		});
		expect(((await res.json()) as { activated: boolean }).activated).toBe(true);
		expect(sub(t, "u-legacy-qris").status).toBe("active");
	});
});

describe("site-owner plan gates (review #9, C)", () => {
	it("team members follow the owner's plan, not their own", async () => {
		const t = await createMigratedTestApp();
		await t.seedUser({ id: "u-g-owner", plan: "growth", withSite: "s-g" });
		const member = await t.seedUser({ id: "u-m-member", plan: "micro" });
		await t.seedUser({ id: "u-m-owner", plan: "micro", withSite: "s-m" });
		const growthMember = await t.seedUser({ id: "u-g-member", plan: "growth" });
		t.db.exec(`
			INSERT INTO team_members (id, site_id, user_id, role, invited_by, accepted_at) VALUES ('tm1', 's-g', 'u-m-member', 'viewer', 'u-g-owner', '2026-01-01');
			INSERT INTO team_members (id, site_id, user_id, role, invited_by, accepted_at) VALUES ('tm2', 's-m', 'u-g-member', 'viewer', 'u-m-owner', '2026-01-01');
		`);
		const heat = (token: string, site: string) =>
			t.call("GET", `/api/analytics/heatmap?site_id=${site}`, { token });
		expect((await heat(member, "s-g")).status).toBe(200);
		expect((await heat(growthMember, "s-m")).status).toBe(403);
		const funnel = await t.call("GET", "/api/analytics/funnel?site_id=s-g", { token: member });
		expect(funnel.status).toBe(200);
	});
});

describe("Pakasir plan change, site delete, purge, quota (review #10-14)", () => {
	it("a different plan starts a fresh period; the same plan stacks", async () => {
		const t = await createMigratedTestApp({ PAKASIR_API_KEY: "k" });
		const token = await t.seedUser({ id: "u-chg", plan: "micro" });
		const pay = async (plan: string, amount: number) => {
			const r = await t.call("POST", "/api/billing/checkout/pakasir", { token, body: { plan } });
			const order = ((await r.json()) as { data: { order_id: string } }).data.order_id;
			globalThis.fetch = (async () =>
				Response.json({
					transaction: { amount, order_id: order, status: "completed" },
				})) as unknown as typeof fetch;
			await t.call("POST", "/api/webhooks/pakasir", {
				body: { amount, order_id: order, project: "revklik", status: "completed" },
			});
			return Date.parse(sub(t, "u-chg").current_period_end);
		};
		const growthEnd = await pay("growth", 192_000);
		expect(Math.abs(growthEnd - (Date.now() + 30 * DAY))).toBeLessThan(60_000);
		const stacked = await pay("growth", 192_000);
		expect(Math.abs(stacked - (Date.now() + 60 * DAY))).toBeLessThan(60_000);
		const switched = await pay("starter", 64_000);
		expect(Math.abs(switched - (Date.now() + 30 * DAY))).toBeLessThan(60_000);
		expect(sub(t, "u-chg").plan).toBe("starter");
	});

	it("site delete hands back 202 until every table runs dry", async () => {
		const t = await createMigratedTestApp();
		await t.seedUser({ id: "u-big", plan: "growth", withSite: "s-big" });
		const insert = t.db.prepare(
			"INSERT INTO events (id, site_id, session_id, visitor_id, timestamp, path) VALUES (?,?,?,?,?,?)",
		);
		t.db.transaction(() => {
			for (let i = 0; i < PURGE_CHUNK * 2 + 1; i++)
				insert.run(`b${i}`, "s-big", "s", "v", "2026-01-01", "/");
		})();
		const first = await purgeSiteRows(t.d1, "s-big", 1);
		expect(first.unfinished).toContain("events");
		const rest = await purgeSiteRows(t.d1, "s-big");
		expect(rest.unfinished).toEqual([]);
	});

	it("refuses hard-delete horizons under 90 days", async () => {
		const t = await createMigratedTestApp();
		await t.seedUser({ id: "u-p90", withSite: "s-p90" });
		t.db
			.prepare(
				"INSERT INTO events (id, site_id, session_id, visitor_id, timestamp, path) VALUES ('old','s-p90','s','v',?,'/')",
			)
			.run(new Date(Date.now() - 60 * DAY).toISOString());
		expect(await purgeExpiredRows(t.d1, "30")).toBe(0);
		expect(await purgeExpiredRows(t.d1, "90")).toBe(0);
		expect((t.db.query("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n).toBe(1);
	});

	it("a batch is truncated to the remaining allowance", async () => {
		clearSubscriptionCaches();
		const t = await createMigratedTestApp();
		await t.seedUser({ id: "u-cap", plan: "micro", withSite: "s-cap" });
		t.db
			.prepare("INSERT INTO account_usage (user_id, month, events) VALUES ('u-cap', ?, ?)")
			.run(usageMonth(), 10_000 - 2);
		const batch = Array.from({ length: 5 }, (_, i) => ({
			s: "s-cap",
			sid: "sid-cap",
			vid: "vid-cap",
			t: "p",
			p: `/${i}`,
		}));
		const res = await t.call("POST", "/api/track", {
			headers: { "user-agent": BROWSER_UA },
			body: batch,
		});
		expect(res.status).toBe(202);
		expect(
			(
				t.db.query("SELECT COUNT(*) AS n FROM events WHERE site_id = 's-cap'").get() as {
					n: number;
				}
			).n,
		).toBe(2);
		expect(
			(
				t.db.query("SELECT events FROM account_usage WHERE user_id = 'u-cap'").get() as {
					events: number;
				}
			).events,
		).toBe(10_000);
	});
});

describe("GSC token policy (B)", () => {
	it("rejects site-scoped and expired tokens, accepts account tokens", async () => {
		const t = await createMigratedTestApp();
		const session = await t.seedUser({ id: "u-gsc", plan: "growth", withSite: "s-gsc" });
		const add = async (type: "site" | "account", expires: string | null) => {
			const { key } = generateApiKey(type);
			t.db
				.prepare(
					"INSERT INTO api_keys (id, user_id, key_hash, key_prefix, name, token_type, expires_at) VALUES (?,?,?,?,?,?,?)",
				)
				.run(
					crypto.randomUUID(),
					"u-gsc",
					await hashToken(key),
					key.slice(0, 4),
					"t",
					type,
					expires,
				);
			return key;
		};
		const q = (token: string) => t.call("GET", "/api/gsc/queries?site_id=s-gsc", { token });
		expect((await q(await add("site", null))).status).toBe(401);
		expect((await q(await add("account", null))).status).not.toBe(401);
		t.db
			.prepare("UPDATE api_keys SET expires_at = ? WHERE key_hash = ?")
			.run(new Date(Date.now() - 1000).toISOString(), await hashToken(session));
		expect((await q(session)).status).toBe(401);
	});
});
