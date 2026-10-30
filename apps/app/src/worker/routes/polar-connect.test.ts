import { afterEach, describe, expect, it } from "bun:test";
import { createDb } from "../db";
import { bookPolarOrder } from "../lib/polar";
import { syncAllPolar, syncPolarOrders } from "../lib/polar-sync";
import { signStandardWebhook } from "../lib/standard-webhooks";
import { createMigratedTestApp, type MigratedTestApp } from "../lib/test-harness";

const SITE = "s-pc";
const OTHER_SITE = "s-pc2";
const SECRET = "polar_whs_site_secret";
const TOKEN = "polar_oat_super_secret_token";

interface StatusBody {
	success: boolean;
	data: {
		webhook_url: string;
		connected: boolean;
		webhook_secret_configured: boolean;
		access_token_configured: boolean;
		organization_id: string;
		last_sync_at: string | null;
		last_sync_summary: string;
		last_sync_error: string;
		events: { event_type: string; status: string }[];
	};
}

async function setup() {
	const t = await createMigratedTestApp();
	const owner = await t.seedUser({ id: "u-pc", withSite: SITE, plan: "starter" });
	const other = await t.seedUser({ id: "u-pc2", withSite: OTHER_SITE, plan: "starter" });
	return { t, owner, other };
}

const putConfig = (t: MigratedTestApp, token: string, body: Record<string, unknown>) =>
	t.call("PUT", "/api/polar/config", { token, body: { site_id: SITE, ...body } });

async function signedDelivery(
	payload: Record<string, unknown>,
	secret: string,
	sign: (
		body: string,
		id: string,
		ts: string,
		secret: string,
	) => Promise<string> = signStandardWebhook,
) {
	const body = JSON.stringify(payload);
	const id = crypto.randomUUID();
	const ts = String(Math.floor(Date.now() / 1000));
	return {
		body,
		headers: {
			"content-type": "application/json",
			"webhook-id": id,
			"webhook-timestamp": ts,
			"webhook-signature": await sign(body, id, ts, secret),
		},
	};
}

/** Standard Webhooks as the spec defines it: the `whsec_` secret is base64, the key is the decoded bytes. */
async function signWithDecodedKey(body: string, id: string, ts: string, secret: string) {
	const raw = Uint8Array.from(atob(secret.slice("whsec_".length)), (ch) => ch.charCodeAt(0));
	const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, [
		"sign",
	]);
	const mac = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(`${id}.${ts}.${body}`),
	);
	return `v1,${btoa(String.fromCharCode(...new Uint8Array(mac)))}`;
}

const order = (over: Record<string, unknown> = {}) => ({
	id: "ord-1",
	status: "paid",
	paid: true,
	net_amount: 1000,
	total_amount: 1100,
	refunded_amount: 0,
	currency: "usd",
	platform_fee_amount: 80,
	platform_fee_currency: "usd",
	billing_reason: "purchase",
	created_at: new Date().toISOString(),
	customer: { email: "buyer@example.com", name: "Buyer" },
	product: { name: "Pro" },
	metadata: {},
	...over,
});

const TEST_START_MS = Date.now();
const daysAgo = (days: number) => new Date(TEST_START_MS - days * 86_400_000).toISOString();

const event = (type: string, data: Record<string, unknown>, timestamp?: string) => ({
	type,
	...(timestamp ? { timestamp } : {}),
	data,
});

const deliver = async (
	t: MigratedTestApp,
	payload: Record<string, unknown>,
	secret = SECRET,
	query = `?site_id=${SITE}`,
) => t.call("POST", `/api/webhooks/polar${query}`, await signedDelivery(payload, secret));

const eventRow = (t: MigratedTestApp, externalId: string) =>
	t.db
		.query(
			"SELECT revenue, net_revenue, net_source, rail, name, timestamp FROM events WHERE external_id = ?",
		)
		.get(externalId) as {
		revenue: number;
		net_revenue: number | null;
		net_source: string | null;
		rail: string;
		name: string;
		timestamp: string;
	} | null;

describe("Connect Polar: saving the secret", () => {
	it("stores the secret and token but only ever reports that they are configured", async () => {
		const { t, owner } = await setup();
		const empty = (await (
			await t.call("GET", `/api/polar/status?site_id=${SITE}`, { token: owner })
		).json()) as StatusBody;
		expect(empty.data).toMatchObject({
			connected: false,
			webhook_secret_configured: false,
			access_token_configured: false,
		});
		expect(empty.data.webhook_url).toBe(`http://local/api/webhooks/polar?site_id=${SITE}`);

		const saved = await putConfig(t, owner, {
			webhook_secret: `  ${SECRET}  `,
			access_token: TOKEN,
			organization_id: "org-123",
		});
		expect(saved.status).toBe(200);
		const text = await saved.text();
		expect(text).not.toContain(SECRET);
		expect(text).not.toContain(TOKEN);
		expect(JSON.parse(text).data).toMatchObject({
			connected: true,
			webhook_secret_configured: true,
			access_token_configured: true,
			organization_id: "org-123",
		});

		const status = await t.call("GET", `/api/polar/status?site_id=${SITE}`, { token: owner });
		const statusText = await status.text();
		expect(statusText).not.toContain(SECRET);
		expect(statusText).not.toContain(TOKEN);

		const listed = await t.call("GET", `/api/payment-providers?site_id=${SITE}`, { token: owner });
		const listedText = await listed.text();
		expect(listedText).not.toContain(SECRET);
		expect(listedText).not.toContain(TOKEN);

		const stored = t.db
			.query("SELECT config FROM payment_providers WHERE site_id = ? AND provider = 'polar'")
			.get(SITE) as { config: string };
		expect(JSON.parse(stored.config)).toMatchObject({
			webhook_secret: SECRET,
			access_token: TOKEN,
		});
	});

	it("keeps the other fields when one is saved and clears the token on an empty value", async () => {
		const { t, owner } = await setup();
		await putConfig(t, owner, { webhook_secret: SECRET, access_token: TOKEN });
		await putConfig(t, owner, { webhook_secret: "polar_whs_rotated" });
		let stored = JSON.parse(
			(t.db.query("SELECT config FROM payment_providers").get() as { config: string }).config,
		);
		expect(stored).toMatchObject({ webhook_secret: "polar_whs_rotated", access_token: TOKEN });

		const cleared = (await (await putConfig(t, owner, { access_token: "" })).json()) as StatusBody;
		expect(cleared.data.access_token_configured).toBe(false);
		expect(cleared.data.webhook_secret_configured).toBe(true);
		stored = JSON.parse(
			(t.db.query("SELECT config FROM payment_providers").get() as { config: string }).config,
		);
		expect(stored.access_token).toBeUndefined();
	});

	it("rejects empty or malformed values and other people's sites", async () => {
		const { t, owner } = await setup();
		expect((await putConfig(t, owner, { webhook_secret: "" })).status).toBe(400);
		expect((await putConfig(t, owner, { webhook_secret: "two words" })).status).toBe(400);
		expect((await putConfig(t, owner, {})).status).toBe(400);
		const foreign = await t.call("PUT", "/api/polar/config", {
			token: owner,
			body: { site_id: OTHER_SITE, webhook_secret: SECRET },
		});
		expect(foreign.status).toBe(404);
		expect((await t.call("GET", "/api/polar/status?site_id=nope", { token: owner })).status).toBe(
			404,
		);
	});

	it("lets a viewer read the status but not change the secret", async () => {
		const { t, owner } = await setup();
		await putConfig(t, owner, { webhook_secret: SECRET });
		const viewer = await t.seedUser({ id: "u-viewer", plan: "starter" });
		t.db
			.prepare(
				"INSERT INTO team_members (id, site_id, user_id, role, invited_by, accepted_at) VALUES ('tm1', ?, 'u-viewer', 'viewer', 'u-pc', datetime('now'))",
			)
			.run(SITE);
		expect(
			(await t.call("GET", `/api/polar/status?site_id=${SITE}`, { token: viewer })).status,
		).toBe(200);
		expect((await putConfig(t, viewer, { webhook_secret: "polar_whs_evil" })).status).toBe(403);
		expect((await t.call("DELETE", `/api/polar?site_id=${SITE}`, { token: viewer })).status).toBe(
			403,
		);
	});
});

describe("Polar webhook: signature per site", () => {
	it("books an order signed with the saved secret and refuses every other signature", async () => {
		const { t, owner } = await setup();
		await putConfig(t, owner, { webhook_secret: SECRET });

		const ok = await deliver(t, event("order.paid", order()));
		expect(ok.status).toBe(200);
		expect(eventRow(t, "ord-1")).toMatchObject({ revenue: 10, net_revenue: 9.2, rail: "polar" });

		const wrong = await deliver(t, event("order.paid", order({ id: "ord-2" })), "polar_whs_other");
		expect(wrong.status).toBe(401);
		const unsigned = await t.call("POST", `/api/webhooks/polar?site_id=${SITE}`, {
			body: JSON.stringify(event("order.paid", order({ id: "ord-3" }))),
		});
		expect(unsigned.status).toBe(401);
		const tampered = await signedDelivery(event("order.paid", order({ id: "ord-4" })), SECRET);
		const forged = await t.call("POST", `/api/webhooks/polar?site_id=${SITE}`, {
			...tampered,
			body: tampered.body.replace('"net_amount":1000', '"net_amount":9999999'),
		});
		expect(forged.status).toBe(401);
		expect(eventRow(t, "ord-2")).toBeNull();
		expect(eventRow(t, "ord-3")).toBeNull();
		expect(eventRow(t, "ord-4")).toBeNull();
	});

	it("verifies a Standard Webhooks whsec_ secret as well as the UTF-8 form", async () => {
		const { t, owner } = await setup();
		const whsec = `whsec_${btoa("0123456789abcdef0123456789abcdef")}`;
		await putConfig(t, owner, { webhook_secret: whsec });
		const payload = event("order.paid", order({ id: "ord-whsec" }));
		const standard = await t.call(
			"POST",
			`/api/webhooks/polar?site_id=${SITE}`,
			await signedDelivery(payload, whsec, signWithDecodedKey),
		);
		expect(standard.status).toBe(200);
		const legacy = await t.call(
			"POST",
			`/api/webhooks/polar?site_id=${SITE}`,
			await signedDelivery(event("order.paid", order({ id: "ord-legacy" })), whsec),
		);
		expect(legacy.status).toBe(200);
		expect(eventRow(t, "ord-whsec")).not.toBeNull();
		expect(eventRow(t, "ord-legacy")).not.toBeNull();
	});

	it("refuses another site's secret, a site with no secret, and a disconnected site", async () => {
		const { t, owner, other } = await setup();
		await putConfig(t, owner, { webhook_secret: SECRET });
		await t.call("PUT", "/api/polar/config", {
			token: other,
			body: { site_id: OTHER_SITE, webhook_secret: "polar_whs_second_site" },
		});

		const crossed = await deliver(
			t,
			event("order.paid", order()),
			SECRET,
			`?site_id=${OTHER_SITE}`,
		);
		expect(crossed.status).toBe(401);
		expect(eventRow(t, "ord-1")).toBeNull();
		const own = await deliver(
			t,
			event("order.paid", order()),
			"polar_whs_second_site",
			`?site_id=${OTHER_SITE}`,
		);
		expect(own.status).toBe(200);
		expect((await deliver(t, event("order.paid", order()), SECRET, "")).status).toBe(400);
		const unknownSite = await deliver(t, event("order.paid", order()), SECRET, "?site_id=nope");
		expect(unknownSite.status).toBe(401);

		await t.call("DELETE", `/api/polar?site_id=${SITE}`, { token: owner });
		const afterDisconnect = await deliver(t, event("order.paid", order({ id: "ord-gone" })));
		expect(afterDisconnect.status).toBe(401);
		expect(eventRow(t, "ord-gone")).toBeNull();
		expect(
			t.db.query("SELECT COUNT(*) AS n FROM payment_providers WHERE site_id = ?").get(SITE),
		).toEqual({ n: 0 });
	});

	it("takes the site from the endpoint URL before the checkout metadata", async () => {
		const { t, owner } = await setup();
		await putConfig(t, owner, { webhook_secret: SECRET });
		const res = await deliver(
			t,
			event("order.paid", order({ id: "ord-meta", metadata: { revklik_site_id: OTHER_SITE } })),
		);
		expect(res.status).toBe(200);
		expect(t.db.query("SELECT site_id FROM events WHERE external_id = 'ord-meta'").get()).toEqual({
			site_id: SITE,
		});
	});

	it("shows the last events and stores no body for rejected deliveries", async () => {
		const { t, owner } = await setup();
		await putConfig(t, owner, { webhook_secret: SECRET });
		await deliver(t, event("order.paid", order()));
		await deliver(t, event("customer.updated", { id: "cus-1" }));
		await deliver(
			t,
			event("order.paid", order({ id: "ord-x", customer: { email: "leak@x.io" } })),
			"bad",
		);
		await deliver(t, event("order.paid", order({ id: "ord-y" })), "bad");

		const status = (await (
			await t.call("GET", `/api/polar/status?site_id=${SITE}`, { token: owner })
		).json()) as StatusBody;
		const types = status.data.events.map((e) => `${e.event_type}:${e.status}`);
		expect(types).toContain("polar_order.paid:processed");
		expect(types).toContain("polar_customer.updated:processed");
		// Two bad deliveries inside a minute leave one row, without the payload.
		expect(types.filter((entry) => entry.startsWith("polar_invalid_sig"))).toEqual([
			"polar_invalid_sig:failed",
		]);
		const rejected = t.db
			.query("SELECT payload FROM webhook_events WHERE event_type = 'polar_invalid_sig'")
			.get() as { payload: string };
		expect(rejected.payload).not.toContain("leak@x.io");
	});
});

describe("Polar webhook: bookings", () => {
	it("books a renewal order once even when order.created and order.paid both arrive", async () => {
		const { t, owner } = await setup();
		await putConfig(t, owner, { webhook_secret: SECRET });
		const renewal = order({ id: "ord-renew", billing_reason: "subscription_cycle" });
		await deliver(t, event("order.created", renewal));
		const paid = await deliver(t, event("order.paid", renewal));
		expect(await paid.json()).toMatchObject({ duplicate: true });
		expect(eventRow(t, "ord-renew")).toMatchObject({ name: "subscription_payment", revenue: 10 });
		expect(
			t.db.query("SELECT COUNT(*) AS n FROM events WHERE external_id = 'ord-renew'").get(),
		).toEqual({ n: 1 });
		await deliver(t, event("subscription.cycled", { id: "sub-1" }));
		expect(
			t.db.query("SELECT COUNT(*) AS n FROM events WHERE event_type = 'conversion'").get(),
		).toEqual({ n: 1 });
	});

	it("keeps Polar's cents exact for a non-USD order", async () => {
		const { t, owner } = await setup();
		await putConfig(t, owner, { webhook_secret: SECRET });
		await deliver(
			t,
			event(
				"order.paid",
				order({
					id: "ord-eur",
					currency: "eur",
					net_amount: 1999,
					platform_fee_amount: 160,
					platform_fee_currency: "eur",
				}),
			),
		);
		expect(
			t.db
				.query("SELECT revenue, net_revenue, currency FROM events WHERE external_id = 'ord-eur'")
				.get(),
		).toEqual({ revenue: 19.99, net_revenue: 18.39, currency: "EUR" });
	});

	it("books each refund on the day it happened, one row per step of Polar's cumulative total", async () => {
		const { t, owner } = await setup();
		await putConfig(t, owner, { webhook_secret: SECRET });
		const placed = order({ id: "ord-r", created_at: daysAgo(10) });
		await deliver(t, event("order.paid", placed));
		const first = await deliver(
			t,
			event(
				"order.refunded",
				{ ...placed, status: "partially_refunded", refunded_amount: 200 },
				daysAgo(3),
			),
		);
		expect(await first.json()).toMatchObject({ refund: "new" });
		expect(eventRow(t, "ord-r:refund")).toMatchObject({ revenue: -2, timestamp: daysAgo(3) });

		// Polar reports the cumulative total on the second partial refund: the 3.00 it rose by.
		const second = await deliver(
			t,
			event(
				"order.refunded",
				{ ...placed, status: "partially_refunded", refunded_amount: 500 },
				daysAgo(1),
			),
		);
		expect(await second.json()).toMatchObject({ refund: "grown" });
		expect(eventRow(t, "ord-r~200:refund")).toMatchObject({
			revenue: -3,
			net_revenue: -2.76,
			net_source: "refund_ratio",
			timestamp: daysAgo(1),
		});
		// A redelivery of the first refund adds nothing.
		await deliver(
			t,
			event(
				"order.refunded",
				{ ...placed, status: "partially_refunded", refunded_amount: 200 },
				daysAgo(3),
			),
		);
		await deliver(
			t,
			event("order.refunded", { ...placed, status: "refunded", refunded_amount: 1000 }, daysAgo(0)),
		);
		expect(eventRow(t, "ord-r~500:refund")?.revenue).toBe(-5);
		expect(
			t.db.query("SELECT COUNT(*) AS n FROM events WHERE external_id LIKE 'ord-r%'").get(),
		).toEqual({ n: 4 });
		const total = t.db
			.query("SELECT SUM(revenue) AS total FROM events WHERE external_id LIKE 'ord-r%'")
			.get() as { total: number };
		expect(total.total).toBe(0);
		// The sale keeps the order's own date.
		expect(eventRow(t, "ord-r")?.timestamp).toBe(placed.created_at);
	});

	it("dates a refund by the order's modified_at when the event carries no timestamp", async () => {
		const { t, owner } = await setup();
		await putConfig(t, owner, { webhook_secret: SECRET });
		await deliver(
			t,
			event(
				"order.refunded",
				order({
					id: "ord-m",
					created_at: daysAgo(20),
					modified_at: daysAgo(2),
					status: "refunded",
					refunded_amount: 1000,
				}),
			),
		);
		expect(eventRow(t, "ord-m:refund")?.timestamp).toBe(daysAgo(2));
		expect(eventRow(t, "ord-m")?.timestamp).toBe(daysAgo(20));
	});

	it("books the sale together with its refund when the refund is the first event seen", async () => {
		const { t, owner } = await setup();
		await putConfig(t, owner, { webhook_secret: SECRET });
		await deliver(
			t,
			event("order.refunded", order({ id: "ord-late", status: "refunded", refunded_amount: 1000 })),
		);
		expect(eventRow(t, "ord-late")?.revenue).toBe(10);
		expect(eventRow(t, "ord-late:refund")?.revenue).toBe(-10);
	});

	it("ignores pending orders and orders that carry no money", async () => {
		const { t, owner } = await setup();
		await putConfig(t, owner, { webhook_secret: SECRET });
		const pending = await deliver(
			t,
			event("order.created", order({ id: "ord-p", status: "pending", paid: false })),
		);
		expect(await pending.json()).toMatchObject({ action: "pending" });
		const free = await deliver(
			t,
			event(
				"order.paid",
				order({ id: "ord-free", net_amount: 0, total_amount: 0, platform_fee_amount: 0 }),
			),
		);
		expect(await free.json()).toMatchObject({ action: "ignored" });
		expect(
			t.db
				.query("SELECT COUNT(*) AS n FROM events WHERE external_id IN ('ord-p','ord-free')")
				.get(),
		).toEqual({ n: 0 });
	});

	it("keeps an existing visitor name when a later order carries none", async () => {
		const { t, owner } = await setup();
		await putConfig(t, owner, { webhook_secret: SECRET });
		await deliver(
			t,
			event("order.paid", order({ id: "ord-n1", metadata: { revklik_visitor_id: "vis-n" } })),
		);
		await deliver(
			t,
			event(
				"order.paid",
				order({
					id: "ord-n2",
					customer: { email: null, name: null },
					metadata: { revklik_visitor_id: "vis-n" },
				}),
			),
		);
		expect(
			t.db.query("SELECT name, email FROM visitor_profiles WHERE visitor_id = 'vis-n'").get(),
		).toEqual({ name: "Buyer", email: "buyer@example.com" });
	});
});

type FakePage = { items: unknown[]; max_page: number };

interface FakeRefund {
	amount: number;
	created_at: string;
}

type FakeRefunds = Record<string, FakeRefund[]> | "denied";

function ordersApi(
	pages: FakePage[],
	refunds: FakeRefunds = {},
): { fetcher: typeof fetch; urls: string[] } {
	const urls: string[] = [];
	const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
		const url = new URL(String(input));
		urls.push(String(input));
		expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
		if (url.pathname === "/v1/refunds/") {
			if (refunds === "denied") return new Response("no", { status: 403 });
			return Response.json({ items: refunds[url.searchParams.get("order_id") ?? ""] ?? [] });
		}
		const page = Number(url.searchParams.get("page"));
		const body = pages[page - 1] ?? { items: [], max_page: pages.length };
		return Response.json({ items: body.items, pagination: { max_page: body.max_page } });
	}) as typeof fetch;
	return { fetcher, urls };
}

describe("Polar order sync", () => {
	it("books recent orders with Polar's fee and refunds, and a second run changes nothing", async () => {
		const { t } = await setup();
		const db = createDb(t.d1);
		const orders = [
			order({ id: "o-a", net_amount: 2000, platform_fee_amount: 150 }),
			order({ id: "o-b", status: "partially_refunded", refunded_amount: 300 }),
			order({ id: "o-pending", status: "pending", paid: false }),
			order({ id: "o-free", net_amount: 0, total_amount: 0 }),
		];
		const api = ordersApi([{ items: orders, max_page: 1 }], {
			"o-b": [{ amount: 300, created_at: daysAgo(4) }],
		});
		const first = await syncPolarOrders(db, {
			siteId: SITE,
			token: TOKEN,
			lookbackDays: 30,
			fetcher: api.fetcher,
		});
		expect(first).toEqual({
			scanned: 4,
			imported: 2,
			updated: 0,
			unchanged: 0,
			ignored: 2,
			more: false,
		});
		const orderListUrls = () => api.urls.filter((url) => url.includes("/v1/orders/"));
		expect(orderListUrls()[0]).toContain("created_after=");
		expect(orderListUrls()[0]).not.toContain("organization_id");
		expect(eventRow(t, "o-a")).toMatchObject({
			revenue: 20,
			net_revenue: 18.5,
			net_source: "reported",
		});
		expect(eventRow(t, "o-b:refund")).toMatchObject({ revenue: -3, timestamp: daysAgo(4) });

		const again = await syncPolarOrders(db, {
			siteId: SITE,
			token: TOKEN,
			organizationId: "org-9",
			lookbackDays: null,
			fetcher: api.fetcher,
		});
		expect(again).toMatchObject({ imported: 0, updated: 0, unchanged: 2 });
		expect(orderListUrls()[1]).toContain("organization_id=org-9");
		expect(orderListUrls()[1]).not.toContain("created_after");

		// Later: o-b is refunded further and o-a gets its fee after a rule-estimated booking.
		t.db
			.prepare("UPDATE events SET net_source = 'rule', net_revenue = 19 WHERE external_id = 'o-a'")
			.run();
		const later = ordersApi(
			[
				{
					items: [orders[0], order({ id: "o-b", status: "refunded", refunded_amount: 1000 })],
					max_page: 1,
				},
			],
			{
				"o-b": [
					{ amount: 300, created_at: daysAgo(4) },
					{ amount: 700, created_at: daysAgo(1) },
				],
			},
		);
		const third = await syncPolarOrders(db, {
			siteId: SITE,
			token: TOKEN,
			lookbackDays: 30,
			fetcher: later.fetcher,
		});
		expect(third).toMatchObject({ imported: 0, updated: 2 });
		expect(eventRow(t, "o-a")).toMatchObject({ net_revenue: 18.5, net_source: "reported" });
		expect(eventRow(t, "o-b:refund")?.revenue).toBe(-3);
		expect(eventRow(t, "o-b~300:refund")).toMatchObject({ revenue: -7, timestamp: daysAgo(1) });
		// The refund steps count as booked: a further run finds nothing to do.
		const fourth = await syncPolarOrders(db, {
			siteId: SITE,
			token: TOKEN,
			lookbackDays: 30,
			fetcher: later.fetcher,
		});
		expect(fourth).toMatchObject({ imported: 0, updated: 0, unchanged: 2 });
	});

	it("dates a refund by the order's modified_at when the token cannot read refunds", async () => {
		const { t } = await setup();
		const db = createDb(t.d1);
		const refunded = order({
			id: "o-nr",
			status: "refunded",
			refunded_amount: 1000,
			created_at: daysAgo(30),
			modified_at: daysAgo(5),
		});
		const api = ordersApi([{ items: [refunded], max_page: 1 }], "denied");
		await syncPolarOrders(db, {
			siteId: SITE,
			token: TOKEN,
			lookbackDays: 60,
			fetcher: api.fetcher,
		});
		expect(eventRow(t, "o-nr:refund")).toMatchObject({ revenue: -10, timestamp: daysAgo(5) });
		expect(eventRow(t, "o-nr")?.timestamp).toBe(daysAgo(30));
	});

	it("walks every page and stops booking when the run budget is spent", async () => {
		const { t } = await setup();
		const db = createDb(t.d1);
		const api = ordersApi([
			{ items: [order({ id: "p1-a" }), order({ id: "p1-b" })], max_page: 2 },
			{ items: [order({ id: "p2-a" })], max_page: 2 },
		]);
		const limited = await syncPolarOrders(db, {
			siteId: SITE,
			token: TOKEN,
			lookbackDays: null,
			maxBooked: 2,
			fetcher: api.fetcher,
		});
		expect(limited).toMatchObject({ imported: 2, more: true });
		const rest = await syncPolarOrders(db, {
			siteId: SITE,
			token: TOKEN,
			lookbackDays: null,
			maxBooked: 2,
			fetcher: api.fetcher,
		});
		expect(rest).toMatchObject({ imported: 1, unchanged: 2, more: false });
	});

	it("reports a rejected token in plain words", async () => {
		const { t } = await setup();
		const db = createDb(t.d1);
		const denied = (async () => new Response("no", { status: 401 })) as unknown as typeof fetch;
		await expect(
			syncPolarOrders(db, { siteId: SITE, token: TOKEN, lookbackDays: 7, fetcher: denied }),
		).rejects.toThrow("orders:read");
	});
});

describe("Polar order sync route", () => {
	const realFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	it("needs a saved token, then syncs and records the result for the panel", async () => {
		const { t, owner } = await setup();
		await putConfig(t, owner, { webhook_secret: SECRET });
		const refused = await t.call("POST", "/api/polar/sync", {
			token: owner,
			body: { site_id: SITE },
		});
		expect(refused.status).toBe(400);

		await putConfig(t, owner, { access_token: TOKEN });
		const api = ordersApi([{ items: [order({ id: "o-route" })], max_page: 1 }]);
		globalThis.fetch = api.fetcher;
		const ok = await t.call("POST", "/api/polar/sync", {
			token: owner,
			body: { site_id: SITE, days: 30 },
		});
		expect(ok.status).toBe(200);
		expect(((await ok.json()) as { data: { imported: number } }).data.imported).toBe(1);

		const status = (await (
			await t.call("GET", `/api/polar/status?site_id=${SITE}`, { token: owner })
		).json()) as StatusBody;
		expect(status.data.last_sync_at).not.toBeNull();
		expect(status.data.last_sync_summary).toContain("1 new");
		expect(status.data.last_sync_error).toBe("");

		const badDays = await t.call("POST", "/api/polar/sync", {
			token: owner,
			body: { site_id: SITE, days: 0 },
		});
		expect(badDays.status).toBe(400);

		globalThis.fetch = (async () => new Response("no", { status: 403 })) as unknown as typeof fetch;
		const denied = await t.call("POST", "/api/polar/sync", {
			token: owner,
			body: { site_id: SITE },
		});
		expect(denied.status).toBe(502);
		const after = (await (
			await t.call("GET", `/api/polar/status?site_id=${SITE}`, { token: owner })
		).json()) as StatusBody;
		expect(after.data.last_sync_error).toContain("orders:read");
	});
});

describe("Scheduled Polar sync", () => {
	/** Three sites with a saved token, each with two unbooked orders at Polar. */
	async function threeSites() {
		const { t } = await setup();
		for (const [site, user] of [
			["s-cron-1", "u-cron-1"],
			["s-cron-2", "u-cron-2"],
			["s-cron-3", "u-cron-3"],
		] as const) {
			await t.seedUser({ id: user, withSite: site, plan: "starter" });
			t.db
				.prepare(
					"INSERT INTO payment_providers (id, site_id, provider, config, enabled) VALUES (?,?,'polar',?,1)",
				)
				.run(
					`pp-${site}`,
					site,
					JSON.stringify({ webhook_secret: SECRET, access_token: `tok-${site}` }),
				);
		}
		return t;
	}

	const polarFor = (failing: string[] = []) =>
		(async (_input: string | URL | Request, init?: RequestInit) => {
			const token =
				new Headers(init?.headers).get("authorization")?.replace("Bearer tok-", "") ?? "";
			if (failing.includes(token)) return new Response("no", { status: 401 });
			const items = [order({ id: `${token}-a` }), order({ id: `${token}-b` })];
			return Response.json({ items, pagination: { max_page: 1 } });
		}) as typeof fetch;

	const booked = (t: MigratedTestApp, site: string) =>
		(
			t.db
				.query("SELECT COUNT(*) AS n FROM events WHERE site_id = ? AND event_type = 'conversion'")
				.get(site) as { n: number }
		).n;

	it("shares one booking budget across sites and rotates to the least recently synced", async () => {
		const t = await threeSites();
		const db = createDb(t.d1);
		const first = await syncAllPolar(db, {}, { maxBooked: 3, fetcher: polarFor() });
		expect(first.booked).toBe(3);
		expect(booked(t, "s-cron-1") + booked(t, "s-cron-2") + booked(t, "s-cron-3")).toBe(3);
		// The third site was never reached: the budget ran out first.
		expect(booked(t, "s-cron-3")).toBe(0);

		// Next run starts with the site that has not synced yet.
		const second = await syncAllPolar(db, {}, { maxBooked: 2, fetcher: polarFor() });
		expect(second.booked).toBe(2);
		expect(booked(t, "s-cron-3")).toBe(2);
	});

	it("caps the sites visited per run", async () => {
		const t = await threeSites();
		const db = createDb(t.d1);
		const run = await syncAllPolar(db, {}, { maxSites: 1, maxBooked: 40, fetcher: polarFor() });
		expect(run.sites).toBe(1);
		expect(booked(t, "s-cron-1") + booked(t, "s-cron-2") + booked(t, "s-cron-3")).toBe(2);
	});

	it("keeps going after one site fails and records the failure on that site", async () => {
		const t = await threeSites();
		const db = createDb(t.d1);
		await syncAllPolar(db, {}, { maxBooked: 40, fetcher: polarFor(["s-cron-1"]) });
		expect(booked(t, "s-cron-1")).toBe(0);
		expect(booked(t, "s-cron-2")).toBe(2);
		expect(booked(t, "s-cron-3")).toBe(2);
		const failed = t.db
			.query("SELECT config FROM payment_providers WHERE site_id = 's-cron-1'")
			.get() as { config: string };
		expect(JSON.parse(failed.config).last_sync_error).toContain("orders:read");
	});
});

describe("Concurrent refund bookings", () => {
	const refunded = (cents: number) =>
		order({ id: "ord-race", status: "partially_refunded", refunded_amount: cents });
	const refundTotal = (t: MigratedTestApp) =>
		(
			t.db
				.query(
					"SELECT COALESCE(SUM(revenue), 0) AS total FROM events WHERE external_id LIKE 'ord-race%:refund'",
				)
				.get() as { total: number }
		).total;

	it("books each cent once when two deliveries read the same refunded total", async () => {
		const { t } = await setup();
		const db = createDb(t.d1);
		await bookPolarOrder(db, order({ id: "ord-race" }), SITE);
		await bookPolarOrder(db, refunded(300), SITE);
		expect(refundTotal(t)).toBe(-3);
		// A webhook (cumulative 500) and the sync (cumulative 800) both read 300 as booked.
		await Promise.all([
			bookPolarOrder(db, refunded(500), SITE),
			bookPolarOrder(db, refunded(800), SITE),
		]);
		expect(refundTotal(t)).toBe(-8);
		expect(
			t.db
				.query("SELECT COUNT(*) AS n FROM events WHERE external_id LIKE 'ord-race%:refund'")
				.get(),
		).toEqual({ n: 3 });
	});

	it("books the first refund once when deliveries race for it", async () => {
		const { t } = await setup();
		const db = createDb(t.d1);
		await bookPolarOrder(db, order({ id: "ord-race" }), SITE);
		await Promise.all([
			bookPolarOrder(db, refunded(300), SITE),
			bookPolarOrder(db, refunded(500), SITE),
			bookPolarOrder(db, refunded(500), SITE),
		]);
		expect(refundTotal(t)).toBe(-5);
	});
});
