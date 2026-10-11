import { describe, expect, it } from "bun:test";
import { createDb } from "../db";
import { ensureSiteCurrency } from "../lib/currency-backfill";
import { signStandardWebhook } from "../lib/standard-webhooks";
import { createMigratedTestApp, makeD1, type MigratedTestApp } from "../lib/test-harness";
import { hasMigrated, migrateDatabase, SCHEMA_VERSION } from "../migrations";

const DAY = 86_400_000;
const SECRET = "polar_whs_final";

async function polarDelivery(body: unknown) {
	const raw = JSON.stringify(body);
	const id = crypto.randomUUID();
	const ts = String(Math.floor(Date.now() / 1000));
	return {
		body: raw,
		headers: {
			"content-type": "application/json",
			"webhook-id": id,
			"webhook-timestamp": ts,
			"webhook-signature": await signStandardWebhook(raw, id, ts, SECRET),
		},
	};
}

const sub = (t: MigratedTestApp, userId: string) =>
	t.db
		.query(
			"SELECT status, current_period_end, polar_subscription_id FROM subscriptions WHERE user_id = ?",
		)
		.get(userId) as {
		status: string;
		current_period_end: string;
		polar_subscription_id: string | null;
	};

describe("B1: plan gate cannot borrow a foreign site's plan", () => {
	it("a victim's growth site id in the query does not unlock the attacker's own site", async () => {
		const t = await createMigratedTestApp();
		await t.seedUser({ id: "u-victim", plan: "growth", withSite: "s-victim" });
		const attacker = await t.seedUser({ id: "u-attacker", plan: "micro", withSite: "s-attacker" });

		const borrowed = await t.call("POST", "/api/integrations?site_id=s-victim", {
			token: attacker,
			body: { site_id: "s-attacker", type: "kit", name: "Kit", config: {} },
		});
		expect(borrowed.status).toBe(400);

		const queryOnly = await t.call("POST", "/api/integrations?site_id=s-victim", {
			token: attacker,
			body: { type: "kit", name: "Kit", config: {} },
		});
		expect(queryOnly.status).toBe(403);
		expect(((await queryOnly.json()) as { current_plan: string }).current_plan).toBe("micro");

		const invite = await t.call("POST", "/api/team/invite?site_id=s-victim", {
			token: attacker,
			body: { site_id: "s-victim", email: "x@example.com" },
		});
		expect(invite.status).toBe(403);
		expect(t.db.query("SELECT COUNT(*) AS n FROM integrations").get()).toEqual({ n: 0 });
	});
});

describe("S1: existing accounts count as verified", () => {
	it("migration v11 verifies every pre-existing user", async () => {
		const t = await createMigratedTestApp();
		t.db
			.prepare("INSERT INTO users (id, email, password_hash, name, created_at) VALUES (?,?,?,?,?)")
			.run("u-old", "old@example.com", "x", "Old", "2025-01-01T00:00:00Z");
		t.db.exec("UPDATE users SET email_verified_at = NULL");
		t.db.exec("UPDATE schema_version SET version = 10");
		await migrateDatabase(makeD1(t.db) as unknown as D1Database);
		const row = t.db.query("SELECT email_verified_at FROM users WHERE id = 'u-old'").get() as {
			email_verified_at: string;
		};
		expect(row.email_verified_at).toBe("2025-01-01T00:00:00Z");
	});
});

describe("S2: stale checkout ids and out-of-order events", () => {
	it("a row whose id was overwritten by a checkout is repaired and renews", async () => {
		const t = await createMigratedTestApp({ POLAR_WEBHOOK_SECRET: SECRET });
		await t.seedUser({ id: "u-chk", plan: "growth" });
		t.db.exec(
			"UPDATE subscriptions SET status = 'open', polar_subscription_id = 'checkout_abc', polar_customer_id = 'cus_1' WHERE user_id = 'u-chk'",
		);
		t.db.exec("UPDATE schema_version SET version = 10");
		await migrateDatabase(makeD1(t.db) as unknown as D1Database);
		expect(sub(t, "u-chk")).toMatchObject({ status: "active", polar_subscription_id: null });

		const renewed = new Date(Date.now() + 40 * DAY).toISOString();
		await t.call(
			"POST",
			"/api/billing/webhook",
			await polarDelivery({
				type: "subscription.updated",
				data: {
					id: "sub_real",
					customer_id: "cus_1",
					status: "active",
					current_period_end: renewed,
					metadata: { user_id: "u-chk" },
				},
			}),
		);
		expect(sub(t, "u-chk")).toMatchObject({
			polar_subscription_id: "sub_real",
			current_period_end: renewed,
		});
	});

	it("an older subscription.active cannot roll back a later period", async () => {
		const t = await createMigratedTestApp({ POLAR_WEBHOOK_SECRET: SECRET });
		await t.seedUser({ id: "u-ooo", plan: "growth" });
		const later = new Date(Date.now() + 50 * DAY).toISOString();
		t.db
			.prepare(
				"UPDATE subscriptions SET current_period_end = ?, polar_subscription_id = 'sub_new' WHERE user_id = 'u-ooo'",
			)
			.run(later);
		await t.call(
			"POST",
			"/api/billing/webhook",
			await polarDelivery({
				type: "subscription.active",
				data: {
					id: "sub_old",
					status: "active",
					current_period_end: new Date(Date.now() + 5 * DAY).toISOString(),
					metadata: { user_id: "u-ooo", plan: "micro" },
				},
			}),
		);
		expect(sub(t, "u-ooo")).toMatchObject({
			current_period_end: later,
			polar_subscription_id: "sub_new",
		});
	});
});

describe("S4: waiting on another isolate's migration", () => {
	it("a lock loser waits until the schema reaches the target, then proceeds", async () => {
		const t = await createMigratedTestApp();
		t.db.exec(`UPDATE schema_version SET version = ${SCHEMA_VERSION - 1}`);
		t.db
			.prepare("INSERT INTO migration_lock (id, token, locked_at) VALUES (1, 'other', ?)")
			.run(new Date().toISOString());
		const d1 = makeD1(t.db) as unknown as D1Database;
		setTimeout(() => t.db.exec(`UPDATE schema_version SET version = ${SCHEMA_VERSION}`), 400);
		const started = Date.now();
		await migrateDatabase(d1, { lockWaitMs: 5_000 });
		expect(Date.now() - started).toBeGreaterThanOrEqual(350);
		expect(hasMigrated(d1)).toBe(true);
	});
});

describe("nits", () => {
	it("a successful login clears the per-email failure counter", async () => {
		const t = await createMigratedTestApp();
		await t.call("POST", "/api/auth/register", {
			body: { name: "C", email: "clear@example.com", password: "right-password" },
		});
		await t.call("POST", "/api/auth/login", {
			body: { email: "clear@example.com", password: "nope" },
			headers: { "cf-connecting-ip": "1.2.3.4" },
		});
		expect(
			t.db
				.query("SELECT key FROM login_attempts WHERE key = 'login-email:clear@example.com'")
				.get(),
		).toBeTruthy();
		await t.call("POST", "/api/auth/login", {
			body: { email: "clear@example.com", password: "right-password" },
			headers: { "cf-connecting-ip": "1.2.3.4" },
		});
		expect(
			t.db
				.query("SELECT key FROM login_attempts WHERE key = 'login-email:clear@example.com'")
				.get(),
		).toBeNull();
	});

	it("parallel lazy-currency readers share one inference", async () => {
		const t = await createMigratedTestApp();
		await t.seedUser({ id: "u-par", withSite: "s-par" });
		t.db
			.prepare(
				"INSERT INTO events (id, site_id, session_id, visitor_id, timestamp, path, revenue, currency) VALUES ('ep','s-par','s','v',?,'/',1000,'IDR')",
			)
			.run(new Date().toISOString());
		const db = createDb(t.d1);
		const results = await Promise.all([
			ensureSiteCurrency(db, "s-par", "USD", null),
			ensureSiteCurrency(db, "s-par", "USD", null),
		]);
		expect(results).toEqual(["IDR", "IDR"]);
	});
});
