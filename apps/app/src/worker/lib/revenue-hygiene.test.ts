import { describe, expect, it } from "bun:test";
import { createApp } from "../app";
import { createDb } from "../db";
import { getOverviewStats } from "../queries/analytics";
import { generateId, hashToken } from "../utils";
import { createMigratedTestApp, testExecCtx, type MigratedTestApp } from "./test-harness";
import { canonicalRail } from "./fees";
import { polarReportedNet, processPolarOrder, type PolarOrder } from "./polar";
import {
	patchSql,
	planRevenueBackfill,
	totalsByRail,
	type BackfillEvent,
} from "./revenue-backfill";
import { testEventReason } from "./revenue-hygiene";

const CHROME_UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const SITE = "s-hy";
const RATES = { USD: 1, IDR: 16_000, EUR: 0.9 };

async function setup() {
	const t = await createMigratedTestApp();
	const session = await t.seedUser({ id: "u-hy", plan: "growth", withSite: SITE });
	const writeToken = `rv_${generateId().replaceAll("-", "")}`;
	t.db
		.prepare(
			"INSERT INTO api_keys (id, user_id, key_hash, key_prefix, name, token_type, scopes, site_id) VALUES (?,?,?,?,?,?,?,?)",
		)
		.run(
			generateId(),
			"u-hy",
			await hashToken(writeToken),
			writeToken.slice(0, 8),
			"t",
			"site",
			JSON.stringify(["events:write"]),
			SITE,
		);
	return { t, session, writeToken };
}

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const postServerEvent = (t: MigratedTestApp, token: string, body: Record<string, unknown>) =>
	t.call("POST", "/api/v1/events/server", {
		token,
		body: { site_id: SITE, name: "purchase", currency: "USD", occurred_at: ago(60_000), ...body },
	});

/** The browser tracker reporting a thank-you-page conversion. */
async function trackConversion(
	t: MigratedTestApp,
	event: { sid: string; vid: string; rv: number; ts: number; pr?: Record<string, unknown> },
	device = 0,
) {
	const req = new Request("https://example.com/api/track", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			// A distinct device per buyer: the fingerprint would merge same-device visitors.
			"user-agent": `${CHROME_UA} device/${device}`,
			"cf-connecting-ip": `203.0.113.${9 + device}`,
		},
		body: JSON.stringify([
			{
				s: SITE,
				t: "c",
				n: "purchase",
				p: "/modbus-poll/thanks/",
				h: "example.com",
				cur: "USD",
				...event,
			},
		]),
	});
	Object.defineProperty(req, "cf", {
		value: { country: "NL", city: "Utrecht", asOrganization: "Ziggo" },
		enumerable: true,
	});
	const res = await createApp().fetch(req, t.env, testExecCtx as never);
	expect(res.status).toBe(202);
}

const counted = (t: MigratedTestApp) =>
	t.db
		.query(
			"SELECT id, rail, product, payment_provider, external_id, net_revenue, net_source, excluded_reason FROM events WHERE revenue > 0 ORDER BY timestamp",
		)
		.all() as Array<Record<string, unknown>>;

describe("canonical rail", () => {
	it("maps a legacy provider through the source prefixes but never an explicit rail", () => {
		expect(canonicalRail(null, "app_store_sales_report")).toBe("apple");
		expect(canonicalRail("", "polar_import")).toBe("polar");
		expect(canonicalRail("playground", "polar")).toBe("playground");
		expect(canonicalRail(null, null)).toBe("other");
	});
});

describe("test sales", () => {
	it("recognises test sources and the _test flag", () => {
		expect(testEventReason({ provider: "tracking_smoketest" })).toBe("test");
		expect(testEventReason({ props: { _test: true } })).toBe("test");
		expect(testEventReason({ rail: "test_checkout" })).toBe("test");
		expect(testEventReason({ provider: "polar", props: { source: "polar" } })).toBeNull();
		expect(testEventReason({ provider: "latest_store" })).toBeNull();
	});

	it("keeps test sales out of the portfolio and analytics but stores them", async () => {
		const { t, session, writeToken } = await setup();
		await postServerEvent(t, writeToken, { revenue: 10, external_id: "real", source: "app_store" });
		await postServerEvent(t, writeToken, {
			revenue: 1.23,
			external_id: "smoke",
			source: "tracking_smoketest",
		});
		await postServerEvent(t, writeToken, {
			revenue: 7,
			external_id: "flagged",
			source: "polar",
			props: { _test: true },
		});

		expect(counted(t).map((r) => [r.external_id, r.excluded_reason])).toEqual([
			["real", null],
			["smoke", "test"],
			["flagged", "test"],
		]);
		const res = await t.call("GET", "/api/portfolio/revenue", { token: session });
		const { data } = (await res.json()) as {
			data: { totals: { gross: number; sales: number }; by_rail: { rail: string }[] };
		};
		expect(data.totals).toMatchObject({ gross: 10, sales: 1 });
		expect(data.by_rail.map((r) => r.rail)).toEqual(["apple"]);

		const stats = await getOverviewStats(createDb(t.d1), SITE, ago(3_600_000));
		expect(stats.revenue).toBe(10);
		expect(
			t.db
				.query("SELECT total_revenue FROM visitor_profiles WHERE visitor_id LIKE 'tracking%'")
				.get(),
		).toEqual({ total_revenue: 0 });
	});

	it("flags a browser-reported test conversion at ingest", async () => {
		const { t } = await setup();
		await trackConversion(t, {
			sid: "s1",
			vid: "v1",
			rv: 1.23,
			ts: Date.now() - 60_000,
			pr: { source: "tracking_smoketest", _test: true },
		});
		expect(counted(t)).toMatchObject([{ excluded_reason: "test", rail: "tracking_smoketest" }]);
	});
});

describe("duplicate sales", () => {
	it("books a reloaded thank-you page once", async () => {
		const { t } = await setup();
		const base = Date.now() - 600_000;
		const sale = { vid: "buyer", rv: 29.99, pr: { source: "polar", product: "modbus-poll" } };
		await trackConversion(t, { ...sale, sid: "a", ts: base });
		await trackConversion(t, { ...sale, sid: "b", ts: base + 8_000 });
		await trackConversion(t, { ...sale, sid: "c", ts: base + 3_600_000 / 2 });

		expect(counted(t).map((r) => r.excluded_reason)).toEqual([null, "duplicate", null]);
		expect(counted(t)[0]).toMatchObject({
			rail: "polar",
			product: "modbus-poll",
			payment_provider: "polar",
			net_source: "rule",
		});
		expect(counted(t)[0]?.net_revenue).toBeCloseTo(29.99 * 0.96 - 0.4, 6);
		expect(
			t.db.query("SELECT total_revenue FROM visitor_profiles WHERE visitor_id = 'buyer'").get(),
		).toEqual({ total_revenue: 59.98 });
	});

	it("a confirmed Polar order adopts the browser's row instead of booking the sale twice", async () => {
		const { t, session, writeToken } = await setup();
		await trackConversion(t, {
			sid: "a",
			vid: "buyer",
			rv: 29.99,
			ts: Date.now() - 300_000,
			pr: { source: "polar", product: "modbus-poll" },
		});
		const before = counted(t)[0] as { id: string };

		const res = await postServerEvent(t, writeToken, {
			revenue: 29.99,
			net_revenue: 28.39,
			external_id: "order-1",
			source: "polar",
			rail: "polar",
			props: { polar_order_id: "order-1", product: "Voltrus - Modbus Poll" },
		});
		expect(await res.json()).toMatchObject({
			success: true,
			duplicate: false,
			visitor_id: "buyer",
		});

		expect(counted(t)).toEqual([
			{
				id: before.id,
				rail: "polar",
				product: "modbus-poll",
				payment_provider: "polar",
				external_id: "order-1",
				net_revenue: 28.39,
				net_source: "reported",
				excluded_reason: null,
			},
		]);
		const props = t.db.query("SELECT props FROM events WHERE id = ?").get(before.id) as {
			props: string;
		};
		expect(JSON.parse(props.props)).toMatchObject({
			polar_order_id: "order-1",
			product: "modbus-poll",
			external_id: "order-1",
		});

		// Replaying the order is still idempotent on its id.
		const again = await postServerEvent(t, writeToken, {
			revenue: 29.99,
			external_id: "order-1",
			source: "polar",
			rail: "polar",
		});
		expect(await again.json()).toMatchObject({ duplicate: true });
		expect(counted(t)).toHaveLength(1);

		const pf = await t.call("GET", "/api/portfolio/revenue", { token: session });
		const { data } = (await pf.json()) as { data: { totals: { gross: number; sales: number } } };
		expect(data.totals).toMatchObject({ gross: 29.99, sales: 1 });
	});

	it("an order that names its buyer only adopts that buyer's browser row", async () => {
		const { t, writeToken } = await setup();
		await trackConversion(t, {
			sid: "a",
			vid: "buyer",
			rv: 29.99,
			ts: Date.now() - 300_000,
			pr: { source: "polar" },
		});
		const order = (id: string, visitorId: string) =>
			postServerEvent(t, writeToken, {
				revenue: 29.99,
				external_id: id,
				source: "polar",
				rail: "polar",
				visitor_id: visitorId,
			});

		await order("order-other", "someone-else");
		expect(counted(t)).toHaveLength(2);
		expect(counted(t).filter((r) => r.external_id === null)).toHaveLength(1);

		await order("order-buyer", "buyer");
		expect(counted(t).filter((r) => r.external_id === null)).toHaveLength(0);
		expect(counted(t)).toHaveLength(2);
	});

	it("a browser row arriving after its order is the same sale, once", async () => {
		const { t, writeToken } = await setup();
		await postServerEvent(t, writeToken, {
			revenue: 29.99,
			external_id: "order-1",
			source: "polar",
			rail: "polar",
			occurred_at: ago(120_000),
		});
		const sale = { rv: 29.99, pr: { source: "polar" } };
		await trackConversion(t, { ...sale, sid: "a", vid: "buyer", ts: Date.now() - 60_000 });
		expect(counted(t).map((r) => [r.external_id, r.excluded_reason])).toEqual([
			["order-1", null],
			[null, "duplicate"],
		]);
		expect(
			t.db.query("SELECT total_revenue FROM visitor_profiles WHERE visitor_id = 'buyer'").get(),
		).toEqual({ total_revenue: 0 });

		// The order is claimed: another buyer's identical sale is a new sale.
		await trackConversion(t, { ...sale, sid: "b", vid: "second", ts: Date.now() - 30_000 }, 1);
		expect(counted(t).filter((r) => r.excluded_reason === null)).toHaveLength(2);
	});

	it("a browser row never merges into another buyer's linked order", async () => {
		const { t, writeToken } = await setup();
		await postServerEvent(t, writeToken, {
			revenue: 29.99,
			external_id: "order-1",
			source: "polar",
			rail: "polar",
			visitor_id: "buyer",
			occurred_at: ago(120_000),
		});
		await trackConversion(t, {
			sid: "a",
			vid: "stranger",
			rv: 29.99,
			ts: Date.now() - 60_000,
			pr: { source: "polar" },
		});
		expect(counted(t).filter((r) => r.excluded_reason === null)).toHaveLength(2);
	});

	it("adopts by time when the browser reported the list price and the order what was paid", async () => {
		const { t, writeToken } = await setup();
		await trackConversion(t, {
			sid: "a",
			vid: "buyer",
			rv: 29.99,
			ts: Date.now() - 300_000,
			pr: { source: "polar", product: "modbus-poll" },
		});
		await postServerEvent(t, writeToken, {
			revenue: 19.99,
			net_revenue: 18.5,
			external_id: "order-1",
			source: "polar",
			rail: "polar",
			occurred_at: ago(290_000),
		});
		expect(counted(t)).toMatchObject([
			{ external_id: "order-1", net_revenue: 18.5, net_source: "reported", excluded_reason: null },
		]);
		expect(t.db.query("SELECT revenue FROM events WHERE external_id = 'order-1'").get()).toEqual({
			revenue: 19.99,
		});
		expect(
			t.db.query("SELECT total_revenue FROM visitor_profiles WHERE visitor_id = 'buyer'").get(),
		).toEqual({ total_revenue: 19.99 });
	});

	it("a browser row with the list price after its cheaper order is still the same sale", async () => {
		const { t, writeToken } = await setup();
		await postServerEvent(t, writeToken, {
			revenue: 19.99,
			external_id: "order-1",
			source: "polar",
			rail: "polar",
			occurred_at: ago(120_000),
		});
		await trackConversion(t, {
			sid: "a",
			vid: "buyer",
			rv: 29.99,
			ts: Date.now() - 100_000,
			pr: { source: "polar" },
		});
		expect(counted(t).map((r) => [r.external_id, r.excluded_reason])).toEqual([
			["order-1", null],
			[null, "duplicate"],
		]);
	});

	it("each browser row takes its own order when two unlinked orders are minutes apart", async () => {
		const { t, writeToken } = await setup();
		for (const [id, ageMs] of [
			["order-1", 360_000],
			["order-2", 180_000],
		] as const) {
			await postServerEvent(t, writeToken, {
				revenue: 19.99,
				external_id: id,
				source: "polar",
				rail: "polar",
				occurred_at: ago(ageMs),
			});
		}
		const sale = { rv: 19.99, pr: { source: "polar" } };
		// Both browser rows sit nearest to order-1; the second must take order-2.
		await trackConversion(t, { ...sale, sid: "a", vid: "b1", ts: Date.now() - 330_000 }, 0);
		await trackConversion(t, { ...sale, sid: "b", vid: "b2", ts: Date.now() - 300_000 }, 1);

		const browser = t.db
			.query(
				"SELECT excluded_reason, json_extract(props, '$.duplicate_of') AS of FROM events WHERE external_id IS NULL ORDER BY timestamp",
			)
			.all();
		expect(browser).toEqual([
			{ excluded_reason: "duplicate", of: "order-1" },
			{ excluded_reason: "duplicate", of: "order-2" },
		]);
		expect(counted(t).filter((r) => r.excluded_reason === null)).toHaveLength(2);

		// A third browser row finds both orders taken: a new sale.
		await trackConversion(t, { ...sale, sid: "c", vid: "b3", ts: Date.now() - 240_000 }, 2);
		expect(counted(t).filter((r) => r.excluded_reason === null)).toHaveLength(3);
	});

	it("does not merge sales beyond the match window", async () => {
		const { t, writeToken } = await setup();
		await trackConversion(t, {
			sid: "a",
			vid: "buyer",
			rv: 14.99,
			ts: Date.now() - 4 * 3_600_000,
			pr: { source: "polar" },
		});
		await postServerEvent(t, writeToken, {
			revenue: 29.99,
			external_id: "order-a",
			source: "polar",
			rail: "polar",
		});
		await postServerEvent(t, writeToken, {
			revenue: 14.99,
			external_id: "order-b",
			source: "polar",
			rail: "polar",
			occurred_at: ago(60_000),
		});
		expect(counted(t)).toHaveLength(3);
	});
});

describe("excluded rows keep their idempotency", () => {
	it("a replayed test sale and its refund answer duplicate instead of failing", async () => {
		const { t, writeToken } = await setup();
		const sale = { revenue: 10, external_id: "smoke-1", source: "tracking_smoketest" };
		expect((await postServerEvent(t, writeToken, sale)).status).toBe(200);
		const again = await postServerEvent(t, writeToken, sale);
		expect(again.status).toBe(200);
		expect(await again.json()).toMatchObject({ duplicate: true });

		const refund = {
			name: "refund",
			revenue: -4,
			external_id: "smoke-1:refund",
			source: "tracking_smoketest",
		};
		expect((await postServerEvent(t, writeToken, refund)).status).toBe(200);
		expect(
			t.db
				.query(
					"SELECT net_source, excluded_reason FROM events WHERE external_id = 'smoke-1:refund'",
				)
				.get(),
		).toEqual({ net_source: "refund_ratio", excluded_reason: "test" });
		expect(t.db.query("SELECT COUNT(*) AS n FROM events").get()).toEqual({ n: 2 });
	});
});

describe("Polar proceeds", () => {
	const order = (extra: Partial<PolarOrder> = {}): PolarOrder => ({
		id: "ord-1",
		status: "paid",
		net_amount: 2999,
		total_amount: 3299,
		currency: "usd",
		created_at: ago(60_000),
		billing_reason: "purchase",
		...extra,
	});

	it("books a refunded order as a sale and a negative refund at the sale's net ratio", async () => {
		const { t } = await setup();
		const refunded = order({
			id: "ord-ref",
			status: "refunded",
			net_amount: 908,
			total_amount: 999,
			refunded_amount: 908,
			platform_fee_amount: 95,
			platform_fee_currency: "usd",
		});
		expect(await processPolarOrder(createDb(t.d1), refunded, SITE)).toBe("refunded");
		const rows = t.db
			.query(
				"SELECT external_id, revenue, net_revenue, net_source FROM events WHERE revenue != 0 ORDER BY revenue DESC",
			)
			.all() as Array<{
			external_id: string;
			revenue: number;
			net_revenue: number;
			net_source: string;
		}>;
		expect(rows.map((r) => [r.external_id, r.revenue, r.net_source])).toEqual([
			["ord-ref", 9.08, "reported"],
			["ord-ref:refund", -9.08, "refund_ratio"],
		]);
		expect(rows[0]?.net_revenue).toBeCloseTo(8.13, 6);
		expect(rows[1]?.net_revenue).toBeCloseTo(-8.13, 6);
	});

	it("derives net from Polar's platform fee and rejects unusable fees", () => {
		expect(polarReportedNet(2999, 160, "usd", "usd")).toBe(28.39);
		expect(polarReportedNet(2999, null, "usd", null)).toBeNull();
		expect(polarReportedNet(2999, 160, "usd", "eur")).toBeNull();
		expect(polarReportedNet(2999, 5000, "usd", "usd")).toBeNull();
	});

	it("stores the reported net, else the rule, and a re-import upgrades the estimate", async () => {
		const { t } = await setup();
		const db = createDb(t.d1);
		expect(await processPolarOrder(db, order(), SITE)).toBe("imported");
		const row = () =>
			t.db
				.query("SELECT rail, net_revenue, net_source FROM events WHERE external_id = 'ord-1'")
				.get() as {
				rail: string;
				net_revenue: number;
				net_source: string;
			};
		expect(row()).toMatchObject({ rail: "polar", net_source: "rule" });
		expect(row().net_revenue).toBeCloseTo(29.99 * 0.96 - 0.4, 6);

		expect(
			await processPolarOrder(
				db,
				order({ platform_fee_amount: 160, platform_fee_currency: "usd" }),
				SITE,
			),
		).toBe("skipped");
		expect(row()).toEqual({ rail: "polar", net_revenue: 28.39, net_source: "reported" });
		expect(counted(t)).toHaveLength(1);
	});
});

describe("portfolio net and rail", () => {
	it("estimates unpriced rows per group: percent on the sum, fixed fee per row", async () => {
		const { t, session } = await setup();
		const now = new Date().toISOString();
		const insert = t.db.prepare(
			"INSERT INTO events (id, site_id, session_id, visitor_id, timestamp, event_type, name, path, revenue, currency, payment_provider) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
		);
		for (const id of ["p1", "p2", "p3"]) {
			insert.run(id, SITE, "x", "v", now, "conversion", "purchase", "/", 10, "USD", "polar");
		}
		insert.run("p4", SITE, "x", "v", now, "refund", "refund", "/", -10, "USD", "polar");
		const res = await t.call("GET", "/api/portfolio/revenue", { token: session });
		const { data } = (await res.json()) as {
			data: { totals: { net: number; estimated_rows: number; sales: number; refunds: number } };
		};
		// sales: 30 x 0.96 - 3 x 0.40 = 27.6; refund: -(10 x 0.96 - 0.40) = -9.2
		expect(data.totals.net).toBeCloseTo(27.6 - 9.2, 6);
		expect(data.totals).toMatchObject({ estimated_rows: 4, sales: 3, refunds: 1 });
	});

	it("groups legacy provider rows under the canonical rail and never shows a missing net as gross", async () => {
		const { t, session } = await setup();
		const now = new Date().toISOString();
		const insert = t.db.prepare(
			"INSERT INTO events (id, site_id, session_id, visitor_id, timestamp, event_type, name, path, revenue, currency, payment_provider) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
		);
		insert.run(
			"l1",
			SITE,
			"x",
			"v",
			now,
			"conversion",
			"purchase",
			"/",
			10,
			"USD",
			"app_store_sales_report",
		);
		insert.run("l2", SITE, "x", "v", now, "conversion", "purchase", "/", 10, "USD", "polar_import");
		t.db
			.prepare(
				"INSERT INTO events (id, site_id, session_id, visitor_id, timestamp, event_type, name, path, revenue, currency, rail, net_revenue, net_source) VALUES ('l3',?,?,?,?,?,?,?,?,?,?,?,?)",
			)
			.run(SITE, "x", "v", now, "conversion", "purchase", "/", 10, "USD", "apple", 8.1, "reported");

		const res = await t.call("GET", "/api/portfolio/revenue", { token: session });
		const { data } = (await res.json()) as {
			data: {
				totals: { gross: number; net: number; estimated_rows: number };
				by_rail: { rail: string; gross: number; net: number; estimated_rows: number }[];
				recent: { rail: string; net_source: string; net_revenue: number }[];
			};
		};
		const rails = Object.fromEntries(data.by_rail.map((r) => [r.rail, r]));
		expect(Object.keys(rails).sort()).toEqual(["apple", "polar"]);
		expect(rails.apple).toMatchObject({ gross: 20, estimated_rows: 1 });
		expect(rails.apple?.net).toBeCloseTo(8.5 + 8.1);
		expect(rails.polar?.net).toBeCloseTo(10 * 0.96 - 0.4);
		expect(data.totals.estimated_rows).toBe(2);
		expect(data.totals.net).toBeCloseTo(8.5 + 8.1 + 9.2);
		const estimated = data.recent.filter((r) => r.net_source === "estimated");
		expect(estimated).toHaveLength(2);
		expect(data.recent.find((r) => r.net_source === "reported")?.net_revenue).toBe(8.1);
	});
});

describe("revenue backfill", () => {
	const owner = "u-hy";
	const row = (over: Partial<BackfillEvent> & { id: string }): BackfillEvent => ({
		site_id: SITE,
		owner_id: owner,
		visitor_id: `v-${over.id}`,
		timestamp: "2026-08-10T10:00:00.000Z",
		event_type: "conversion",
		path: "/p",
		revenue: 10,
		currency: "USD",
		rail: null,
		product: null,
		payment_provider: null,
		net_revenue: null,
		net_source: null,
		external_id: null,
		props: null,
		excluded_reason: null,
		...over,
	});
	const ctx = { rates: RATES, rules: new Map() };

	const legacy = (): BackfillEvent[] => [
		row({
			id: "asr",
			payment_provider: "app_store_sales_report",
			path: "/app_store_sales_report",
			external_id: "sr:2026-08-10:modbus-poll:DE:EUR:22.99",
			revenue: 22.99,
			currency: "EUR",
			props: JSON.stringify({ app: "modbus-poll", source: "app_store_sales_report" }),
		}),
		row({
			id: "smoke",
			payment_provider: "tracking_smoketest",
			props: JSON.stringify({ _test: true }),
		}),
		row({
			id: "p1",
			visitor_id: "buyer",
			payment_provider: "polar",
			path: "/thanks/",
			revenue: 29.99,
			timestamp: "2026-07-17T14:38:35.499Z",
			props: JSON.stringify({ product: "modbus-poll", source: "polar" }),
		}),
		row({
			id: "p2",
			visitor_id: "buyer",
			payment_provider: "polar",
			path: "/thanks/",
			revenue: 29.99,
			timestamp: "2026-07-17T14:38:43.898Z",
			props: JSON.stringify({ product: "modbus-poll", source: "polar" }),
		}),
		row({
			id: "imp",
			payment_provider: "polar_import",
			external_id: "ord-9",
			revenue: 9.99,
			timestamp: "2026-05-13T09:24:14.269857Z",
			props: JSON.stringify({ polar_order_id: "ord-9" }),
		}),
		row({
			id: "imp-ref",
			payment_provider: "polar_import",
			external_id: "ord-9:refund",
			revenue: -4.995,
			timestamp: "2026-05-14T09:24:14.269857Z",
		}),
	];

	it("fixes rail, product, net and exclusions, and a second pass finds nothing", () => {
		const events = legacy();
		const plan = planRevenueBackfill(events, ctx);
		const byId = Object.fromEntries(plan.patches.map((p) => [p.id, p]));

		expect(byId.asr).toMatchObject({ rail: "apple", product: "modbus-poll" });
		expect(byId.asr?.net?.net_revenue).toBeCloseTo(22.99 * 0.85, 6);
		expect(byId.smoke?.excluded_reason).toBe("test");
		expect(byId.p1?.excluded_reason).toBeUndefined();
		expect(byId.p2?.excluded_reason).toBe("duplicate");
		expect(byId.p1).toMatchObject({ rail: "polar", product: "modbus-poll" });
		expect(byId.imp?.net?.net_source).toBe("rule");
		expect(byId["imp-ref"]?.net).toEqual({
			net_revenue: expect.closeTo((-4.995 * (9.99 * 0.96 - 0.4)) / 9.99, 6),
			net_source: "refund_ratio",
		});
		expect(plan.counts).toMatchObject({ test: 1, duplicate: 1 });

		// Apply the patches to the stored rows: nothing is left to fix.
		const applied = events.map((e) => {
			const p = byId[e.id];
			return p
				? {
						...e,
						rail: p.rail ?? e.rail,
						product: p.product ?? e.product,
						payment_provider: p.payment_provider ?? e.payment_provider,
						net_revenue: p.net?.net_revenue ?? e.net_revenue,
						net_source: p.net?.net_source ?? e.net_source,
						excluded_reason: p.excluded_reason ?? e.excluded_reason,
					}
				: e;
		});
		expect(planRevenueBackfill(applied, ctx).patches).toEqual([]);
	});

	it("applies as guarded SQL: once changes rows, twice changes nothing", async () => {
		const { t } = await setup();
		const events = legacy();
		const insert = t.db.prepare(
			"INSERT INTO events (id, site_id, session_id, visitor_id, timestamp, event_type, name, path, revenue, currency, payment_provider, external_id, props) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
		);
		for (const e of events) {
			insert.run(
				e.id,
				e.site_id,
				"x",
				e.visitor_id,
				e.timestamp,
				e.event_type,
				"purchase",
				e.path,
				e.revenue,
				e.currency,
				e.payment_provider,
				e.external_id,
				e.props,
			);
		}
		t.db
			.prepare(
				"INSERT INTO visitor_profiles (id, site_id, visitor_id, total_revenue) VALUES ('vp', ?, 'buyer', 59.98)",
			)
			.run(SITE);

		const run = () => {
			const plan = planRevenueBackfill(events, ctx);
			for (const p of plan.patches) for (const sql of patchSql(p)) t.db.exec(sql);
		};
		run();
		const snapshot = () => ({
			events: t.db
				.query(
					"SELECT id, rail, product, net_revenue, net_source, excluded_reason FROM events ORDER BY id",
				)
				.all(),
			profile: t.db
				.query("SELECT total_revenue FROM visitor_profiles WHERE visitor_id = 'buyer'")
				.get(),
		});
		const once = snapshot();
		expect(once.profile).toEqual({ total_revenue: 29.99 });
		expect(once.events.find((e) => (e as { id: string }).id === "p2")).toMatchObject({
			excluded_reason: "duplicate",
			rail: "polar",
		});
		run();
		expect(snapshot()).toEqual(once);
	});

	it("a test order never claims a real browser sale, and a linked order only its buyer's", () => {
		const browser = (id: string, visitor: string) =>
			row({
				id,
				visitor_id: visitor,
				payment_provider: "polar",
				path: "/thanks/",
				revenue: 29.99,
				props: JSON.stringify({ source: "polar" }),
			});
		const order = (id: string, visitor: string, over: Partial<BackfillEvent> = {}) =>
			row({
				id,
				visitor_id: visitor,
				payment_provider: "polar",
				rail: "polar",
				external_id: id,
				revenue: 29.99,
				props: JSON.stringify({ source: "polar" }),
				...over,
			});

		const testOrder = planRevenueBackfill(
			[
				browser("b1", "buyer"),
				order("o-test", "polar_o_test", { props: JSON.stringify({ _test: true }) }),
			],
			ctx,
		);
		const testIds = Object.fromEntries(testOrder.patches.map((p) => [p.id, p.excluded_reason]));
		expect(testIds["o-test"]).toBe("test");
		expect(testIds.b1).toBeUndefined();

		const linked = planRevenueBackfill(
			[browser("b2", "stranger"), order("o-linked", "buyer")],
			ctx,
		);
		// The stranger's row is not the buyer's sale, and nothing vouches for the rail's orders.
		expect(linked.patches.find((p) => p.id === "b2")?.excluded_reason).toBeUndefined();

		const claimed = planRevenueBackfill([browser("b3", "buyer"), order("o-linked2", "buyer")], ctx);
		expect(claimed.patches.find((p) => p.id === "b3")?.excluded_reason).toBe("duplicate");
	});

	it("matches browser rows to orders by time despite a different amount and excludes the unconfirmed", () => {
		const base = Date.parse("2026-08-10T10:00:00Z");
		const at = (ms: number) => new Date(base + ms).toISOString();
		const browser = (id: string, visitor: string, ms: number, revenue = 29.99) =>
			row({
				id,
				visitor_id: visitor,
				payment_provider: "polar",
				path: "/thanks/",
				revenue,
				timestamp: at(ms),
				props: JSON.stringify({ source: "polar" }),
			});
		const order = (id: string, ms: number, revenue: number) =>
			row({
				id,
				visitor_id: `polar_${id}`,
				payment_provider: "polar",
				rail: "polar",
				external_id: id,
				revenue,
				timestamp: at(ms),
				props: JSON.stringify({ source: "polar" }),
			});
		const events = [
			order("o1", 0, 19.99),
			browser("matched", "v1", 15_000),
			browser("phantom-in", "v2", 3_600_000),
			order("o2", 7_200_000, 14.99),
			browser("matched2", "v3", 7_200_000 + 20_000, 14.99),
			browser("phantom-after", "v4", 10_800_000),
		];
		const verdict = (plan: ReturnType<typeof planRevenueBackfill>) =>
			Object.fromEntries(plan.patches.map((p) => [p.id, p.excluded_reason]));

		// Nobody vouches for the rail's orders: unclaimed browser rows stay counted.
		const byDefault = planRevenueBackfill(events, ctx);
		expect(verdict(byDefault)).toMatchObject({ matched: "duplicate", matched2: "duplicate" });
		expect(verdict(byDefault)["phantom-in"]).toBeUndefined();
		expect(byDefault.counts.unconfirmed).toBe(0);
		// A matched row remembers its order so a later live browser row cannot claim it again.
		expect(byDefault.patches.find((p) => p.id === "matched")?.duplicate_of).toBe("o1");

		// An import of every order up to an instant vouches for the period up to it.
		const through = new Map([[`${SITE}\u0000polar`, base + 4 * 3_600_000]]);
		const complete = planRevenueBackfill(events, { ...ctx, confirmedThrough: through });
		expect(verdict(complete)["phantom-after"]).toBe("unconfirmed");
		expect(complete.counts).toMatchObject({ duplicate: 2, unconfirmed: 2 });
		expect(verdict(complete).o1).toBeUndefined();
	});

	it("reports per-rail totals before and after", () => {
		const events = legacy();
		const before = totalsByRail(events, ctx, "USD", "legacy");
		const after = totalsByRail(events, ctx, "USD", "backfilled");
		expect(before.map((r) => r.rail).sort()).toEqual(
			["app_store_sales_report", "polar", "polar_import", "tracking_smoketest"].sort(),
		);
		expect(before.every((r) => r.net === r.gross)).toBe(true);
		expect(after.map((r) => r.rail).sort()).toEqual(["apple", "polar"]);
		const polar = after.find((r) => r.rail === "polar");
		expect(polar?.sales).toBe(2);
		expect(polar?.gross).toBeCloseTo(29.99 + 9.99 - 4.995, 6);
		expect(polar?.net).toBeLessThan(polar?.gross ?? 0);
	});
});
