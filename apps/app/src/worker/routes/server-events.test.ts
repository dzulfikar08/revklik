import { describe, expect, it } from "bun:test";
import { createMigratedTestApp, type MigratedTestApp } from "../lib/test-harness";
import { signStandardWebhook } from "../lib/standard-webhooks";
import { generateId, hashToken } from "../utils";

async function addToken(
	t: MigratedTestApp,
	userId: string,
	scopes: string[],
	siteId: string | null,
) {
	const token = `${siteId ? "rv_" : "rvt_"}${generateId().replaceAll("-", "")}`;
	t.db
		.prepare(
			"INSERT INTO api_keys (id, user_id, key_hash, key_prefix, name, token_type, scopes, site_id) VALUES (?,?,?,?,?,?,?,?)",
		)
		.run(
			generateId(),
			userId,
			await hashToken(token),
			token.slice(0, 8),
			"t",
			siteId ? "site" : "account",
			JSON.stringify(scopes),
			siteId,
		);
	return token;
}

async function setup() {
	const t = await createMigratedTestApp();
	await t.seedUser({ id: "u-se", withSite: "s-se" });
	const writer = await addToken(t, "u-se", ["events:write", "analytics:read"], "s-se");
	return { t, writer };
}

const sale = (over: Record<string, unknown> = {}) => ({
	site_id: "s-se",
	name: "purchase",
	revenue: 9.99,
	currency: "USD",
	external_id: "tx-1",
	source: "app_store",
	props: { product: "pro", app: "waqtu", country: "ID", environment: "Sandbox" },
	occurred_at: new Date(Date.now() - 60_000).toISOString(),
	...over,
});

interface OverviewBody {
	data: { revenue: number; conversions: number; visitors: number };
}

async function overview(t: MigratedTestApp, token: string): Promise<OverviewBody> {
	const res = await t.call("GET", "/api/v1/analytics/overview?site_id=s-se&range=7d", { token });
	return res.json();
}

describe("POST /api/v1/events/server", () => {
	it("requires a token with the events:write scope", async () => {
		const { t } = await setup();
		expect((await t.call("POST", "/api/v1/events/server", { body: sale() })).status).toBe(401);
		const readOnly = await addToken(t, "u-se", ["analytics:read"], "s-se");
		expect(
			(await t.call("POST", "/api/v1/events/server", { token: readOnly, body: sale() })).status,
		).toBe(403);
	});

	it("is bound to the token's own site", async () => {
		const { t, writer } = await setup();
		const res = await t.call("POST", "/api/v1/events/server", {
			token: writer,
			body: sale({ site_id: "someone-elses" }),
		});
		expect(res.status).toBe(403);
	});

	it("books a sale once and shows it as revenue and a conversion", async () => {
		const { t, writer } = await setup();
		const first = await t.call("POST", "/api/v1/events/server", { token: writer, body: sale() });
		expect(first.status).toBe(200);
		const body: { success: boolean; duplicate: boolean; event_id: string } = await first.json();
		expect(body).toMatchObject({ success: true, duplicate: false });

		const again = await t.call("POST", "/api/v1/events/server", { token: writer, body: sale() });
		expect(await again.json()).toMatchObject({ duplicate: true, event_id: body.event_id });
		expect(t.db.query("SELECT COUNT(*) AS n FROM events WHERE external_id = 'tx-1'").get()).toEqual(
			{ n: 1 },
		);

		const row = t.db
			.query(
				"SELECT event_type, revenue, currency, payment_provider, country FROM events WHERE external_id = 'tx-1'",
			)
			.get();
		expect(row).toEqual({
			event_type: "conversion",
			revenue: 9.99,
			currency: "USD",
			payment_provider: "app_store",
			country: "ID",
		});
		const stats = await overview(t, writer);
		expect(stats.data.revenue).toBeCloseTo(9.99);
		expect(stats.data.conversions).toBe(1);
	});

	it("records a refund as negative revenue under its own key", async () => {
		const { t, writer } = await setup();
		await t.call("POST", "/api/v1/events/server", { token: writer, body: sale() });
		const refund = await t.call("POST", "/api/v1/events/server", {
			token: writer,
			body: sale({ name: "refund", revenue: -9.99, external_id: "tx-1:refund" }),
		});
		expect(refund.status).toBe(200);
		expect(
			t.db.query("SELECT event_type, revenue FROM events WHERE external_id = 'tx-1:refund'").get(),
		).toEqual({ event_type: "refund", revenue: -9.99 });
		const stats = await overview(t, writer);
		expect(stats.data.revenue).toBeCloseTo(0);
		expect(stats.data.conversions).toBe(1);
		// The refund follows the buyer; a sale is not a site visitor.
		const visitors = t.db
			.query("SELECT COUNT(DISTINCT visitor_id) AS n FROM events WHERE external_id LIKE 'tx-1%'")
			.get();
		expect(visitors).toEqual({ n: 1 });
		expect(stats.data.visitors).toBe(0);
	});

	it("stores zero-revenue events without counting a conversion", async () => {
		const { t, writer } = await setup();
		await t.call("POST", "/api/v1/events/server", {
			token: writer,
			body: sale({ name: "app_store_download", revenue: 0, external_id: "sr:1" }),
		});
		expect(t.db.query("SELECT event_type FROM events WHERE external_id = 'sr:1'").get()).toEqual({
			event_type: "custom",
		});
		expect((await overview(t, writer)).data.conversions).toBe(0);
	});

	it("attributes the sale to the visitor's source when the checkout carries its id", async () => {
		const { t, writer } = await setup();
		t.db
			.prepare(
				"INSERT INTO events (id, site_id, session_id, visitor_id, timestamp, event_type, path, utm_source, utm_campaign, country) VALUES ('pv','s-se','ses-a','vis-a',?, 'pageview','/','bing','spring','ID')",
			)
			.run(new Date(Date.now() - 3_600_000).toISOString());
		await t.call("POST", "/api/v1/events/server", {
			token: writer,
			body: sale({
				source: "polar",
				external_id: "ord-9",
				visitor_id: "vis-a",
				props: { product: "pro" },
			}),
		});
		expect(
			t.db
				.query(
					"SELECT visitor_id, utm_source, utm_campaign, country FROM events WHERE external_id = 'ord-9'",
				)
				.get(),
		).toEqual({ visitor_id: "vis-a", utm_source: "bing", utm_campaign: "spring", country: "ID" });
		expect(
			t.db.query("SELECT total_revenue FROM visitor_profiles WHERE visitor_id = 'vis-a'").get(),
		).toEqual({
			total_revenue: 9.99,
		});
	});

	it("rejects malformed bodies", async () => {
		const { t, writer } = await setup();
		for (const bad of [
			sale({ external_id: undefined }),
			sale({ revenue: "lots" }),
			sale({ name: "" }),
			sale({ occurred_at: "yesterday-ish" }),
			sale({ props: ["x"] }),
		]) {
			const res = await t.call("POST", "/api/v1/events/server", { token: writer, body: bad });
			expect(res.status).toBe(400);
		}
	});
});

describe("Polar webhook booking", () => {
	const SECRET = "site-secret";
	async function deliver(t: MigratedTestApp, type: string, data: Record<string, unknown>) {
		const raw = JSON.stringify({ type, data: { metadata: { revklik_site_id: "s-se" }, ...data } });
		const id = generateId();
		const ts = String(Math.floor(Date.now() / 1000));
		return t.call("POST", "/api/webhooks/polar", {
			body: raw,
			headers: {
				"content-type": "application/json",
				"webhook-id": id,
				"webhook-timestamp": ts,
				"webhook-signature": await signStandardWebhook(raw, id, ts, SECRET),
			},
		});
	}
	async function polarSetup() {
		const { t, writer } = await setup();
		t.db
			.prepare(
				"INSERT INTO integrations (id, site_id, user_id, type, name, config, enabled) VALUES ('ip','s-se','u-se','polar','Polar',?,1)",
			)
			.run(JSON.stringify({ webhook_secret: SECRET }));
		return { t, writer };
	}

	it("reads a real order's net_amount, attributes it, and dedupes order.created + order.paid", async () => {
		const { t, writer } = await polarSetup();
		t.db
			.prepare(
				"INSERT INTO events (id, site_id, session_id, visitor_id, timestamp, event_type, path, utm_source) VALUES ('pv','s-se','ses-p','vis-p',?, 'pageview','/','google')",
			)
			.run(new Date(Date.now() - 3_600_000).toISOString());
		const order = {
			id: "ord-1",
			status: "paid",
			paid: true,
			net_amount: 1999,
			total_amount: 2199,
			currency: "usd",
			billing_reason: "purchase",
			metadata: { revklik_site_id: "s-se", revklik_visitor_id: "vis-p" },
			customer: { email: "a@b.co" },
			product: { name: "Pro" },
		};
		expect((await deliver(t, "order.created", order)).status).toBe(200);
		const paid = await deliver(t, "order.paid", order);
		const paidBody: { duplicate?: boolean } = await paid.json();
		expect(paidBody.duplicate).toBe(true);

		expect(
			t.db
				.query(
					"SELECT revenue, visitor_id, utm_source, payment_provider FROM events WHERE external_id = 'ord-1'",
				)
				.get(),
		).toEqual({
			revenue: 19.99,
			visitor_id: "vis-p",
			utm_source: "google",
			payment_provider: "polar",
		});
		expect((await overview(t, writer)).data.revenue).toBeCloseTo(19.99);
	});

	it("books order.refunded as negative revenue and ignores pending orders", async () => {
		const { t, writer } = await polarSetup();
		const order = { id: "ord-2", status: "paid", paid: true, net_amount: 500, currency: "usd" };
		await deliver(t, "order.paid", order);
		const pending = await deliver(t, "order.created", {
			id: "ord-3",
			status: "pending",
			net_amount: 700,
		});
		expect(await pending.json()).toMatchObject({ action: "pending" });
		await deliver(t, "order.refunded", { ...order, status: "refunded", refunded_amount: 500 });
		expect(
			t.db.query("SELECT revenue FROM events WHERE external_id = 'ord-2:refund'").get(),
		).toEqual({ revenue: -5 });
		expect((await overview(t, writer)).data.revenue).toBeCloseTo(0);
		expect(
			t.db.query("SELECT COUNT(*) AS n FROM events WHERE external_id = 'ord-3'").get(),
		).toEqual({ n: 0 });
	});
});
