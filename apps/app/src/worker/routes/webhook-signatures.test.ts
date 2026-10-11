import { describe, expect, it } from "bun:test";
import { signStandardWebhook } from "../lib/standard-webhooks";
import { createDb } from "../db";
import { inferSiteCurrencies } from "../lib/currency-backfill";
import { createMigratedTestApp, type MigratedTestApp } from "../lib/test-harness";

const orderBody = (site: string, id = "ord_1") =>
	JSON.stringify({
		type: "order.created",
		data: { id, amount: 1500, currency: "usd", metadata: { revklik_site_id: site } },
	});

async function signed(body: string, secret: string, id = crypto.randomUUID()) {
	const ts = String(Math.floor(Date.now() / 1000));
	return {
		body,
		headers: {
			"content-type": "application/json",
			"webhook-id": id,
			"webhook-timestamp": ts,
			"webhook-signature": await signStandardWebhook(body, id, ts, secret),
		},
	};
}

const events = (t: MigratedTestApp, site: string) =>
	(t.db.query("SELECT COUNT(*) AS n FROM events WHERE site_id = ?").get(site) as { n: number }).n;

describe("customer-site Polar webhook (DEV-29)", () => {
	it("fails closed without a secret or signature", async () => {
		const t = await createMigratedTestApp();
		await t.seedUser({ id: "u-pw0", withSite: "s-pw0" });
		const res = await t.call("POST", "/api/webhooks/polar", { body: orderBody("s-pw0") });
		expect(res.status).toBe(401);

		const t2 = await createMigratedTestApp({ POLAR_WEBHOOK_SECRET: "env-secret" });
		await t2.seedUser({ id: "u-pw1", withSite: "s-pw1" });
		const unsigned = await t2.call("POST", "/api/webhooks/polar", { body: orderBody("s-pw1") });
		expect(unsigned.status).toBe(401);
		expect(events(t2, "s-pw1")).toBe(0);
	});

	it("accepts Standard Webhooks signatures with the site's own secret", async () => {
		const t = await createMigratedTestApp({ POLAR_WEBHOOK_SECRET: "env-secret" });
		await t.seedUser({ id: "u-pw2", withSite: "s-pw2" });
		t.db
			.prepare(
				"INSERT INTO integrations (id, site_id, user_id, type, name, config, enabled) VALUES ('ip','s-pw2','u-pw2','polar','Polar',?,1)",
			)
			.run(JSON.stringify({ webhook_secret: "site-secret" }));

		const wrongKey = await t.call(
			"POST",
			"/api/webhooks/polar",
			await signed(orderBody("s-pw2"), "env-secret"),
		);
		expect(wrongKey.status).toBe(401);

		const ok = await t.call(
			"POST",
			"/api/webhooks/polar",
			await signed(orderBody("s-pw2"), "site-secret"),
		);
		expect(ok.status).toBe(200);
		const dup = await t.call(
			"POST",
			"/api/webhooks/polar",
			await signed(orderBody("s-pw2"), "site-secret"),
		);
		expect(((await dup.json()) as { duplicate?: boolean }).duplicate).toBe(true);
		expect(events(t, "s-pw2")).toBe(1);
	});
});

describe("Stripe webhook (DEV-29)", () => {
	it("rejects deliveries when the integration has no secret", async () => {
		const t = await createMigratedTestApp();
		await t.seedUser({ id: "u-st", withSite: "s-st" });
		t.db
			.prepare(
				"INSERT INTO integrations (id, site_id, user_id, type, name, config, enabled) VALUES ('is','s-st','u-st','stripe','Stripe','{}',1)",
			)
			.run();
		const res = await t.call("POST", "/api/webhooks/stripe", {
			body: {
				type: "checkout.session.completed",
				data: { object: { id: "cs_1", amount_total: 1000, metadata: { revklik_site_id: "s-st" } } },
			},
			headers: { "Stripe-Signature": "t=1,v1=abc" },
		});
		expect(res.status).toBe(401);
		expect(events(t, "s-st")).toBe(0);
	});
});

describe("revenue currency defaults (DEV-33)", () => {
	it("the cron backfill sets existing sites to their dominant revenue currency", async () => {
		const t = await createMigratedTestApp();
		await t.seedUser({ id: "u-cur", withSite: "s-idr" });
		t.db
			.prepare("INSERT INTO sites (id, user_id, name, domain, created_at) VALUES (?,?,?,?,?)")
			.run("s-none", "u-cur", "n", "n.example.com", new Date().toISOString());
		const add = (currency: string) =>
			t.db
				.prepare(
					"INSERT INTO events (id, site_id, session_id, visitor_id, timestamp, path, revenue, currency) VALUES (?,?,?,?,?,?,?,?)",
				)
				.run(crypto.randomUUID(), "s-idr", "s", "v", new Date().toISOString(), "/", 1000, currency);
		add("IDR");
		add("idr");
		add("USD");
		t.db.exec("UPDATE sites SET revenue_currency_source = NULL");
		expect(await inferSiteCurrencies(createDb(t.d1))).toBe(2);
		expect(await inferSiteCurrencies(createDb(t.d1))).toBe(0);
		const cur = (id: string) =>
			(t.db.query("SELECT revenue_currency AS c FROM sites WHERE id = ?").get(id) as { c: string })
				.c;
		expect(cur("s-idr")).toBe("IDR");
		expect(cur("s-none")).toBe("USD");
	});

	it("new sites created from Indonesia default to IDR", async () => {
		const t = await createMigratedTestApp();
		const token = await t.seedUser({ id: "u-new-cur", plan: "growth" });
		await t.call("POST", "/api/sites", {
			token,
			body: { name: "id", domain: "toko.example.id" },
			headers: { "CF-IPCountry": "ID" },
		});
		await t.call("POST", "/api/sites", {
			token,
			body: { name: "us", domain: "shop.example.com" },
			headers: { "CF-IPCountry": "US" },
		});
		const rows = t.db
			.query("SELECT domain, revenue_currency AS c FROM sites WHERE user_id = 'u-new-cur'")
			.all() as { domain: string; c: string }[];
		expect(Object.fromEntries(rows.map((r) => [r.domain, r.c]))).toEqual({
			"toko.example.id": "IDR",
			"shop.example.com": "USD",
		});
	});
});
