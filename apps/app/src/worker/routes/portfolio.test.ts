import { describe, expect, it } from "bun:test";
import { createMigratedTestApp, type MigratedTestApp } from "../lib/test-harness";
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
	const session = await t.seedUser({ id: "u-pf", plan: "growth", withSite: "s-pf" });
	const writer = await addToken(t, "u-pf", ["events:write"], "s-pf");
	const reader = await addToken(t, "u-pf", ["analytics:read"], null);
	return { t, session, writer, reader };
}

const post = (t: MigratedTestApp, token: string, body: Record<string, unknown>) =>
	t.call("POST", "/api/v1/events/server", {
		token,
		body: {
			site_id: "s-pf",
			name: "purchase",
			currency: "USD",
			occurred_at: new Date(Date.now() - 60_000).toISOString(),
			...body,
		},
	});

const stored = (t: MigratedTestApp, externalId: string) =>
	t.db
		.query(
			"SELECT rail, product, revenue, net_revenue, net_source FROM events WHERE external_id = ?",
		)
		.get(externalId);

describe("net revenue at ingest", () => {
	it("stores 8.5 for a 10 USD Apple sale and mirrors the ratio on refunds", async () => {
		const { t, writer } = await setup();
		expect(
			(
				await post(t, writer, {
					revenue: 10,
					external_id: "a1",
					source: "app_store",
					props: { app: "joyorogo" },
				})
			).status,
		).toBe(200);
		expect(stored(t, "a1")).toEqual({
			rail: "apple",
			product: "joyorogo",
			revenue: 10,
			net_revenue: 8.5,
			net_source: "rule",
		});

		await post(t, writer, {
			name: "refund",
			revenue: -4,
			external_id: "a1:refund",
			source: "app_store",
		});
		expect(stored(t, "a1:refund")).toMatchObject({
			net_revenue: -3.4,
			net_source: "refund_ratio",
		});
	});

	it("keeps reported proceeds and validates them", async () => {
		const { t, writer } = await setup();
		await post(t, writer, {
			revenue: 10,
			net_revenue: 7.9,
			rail: "google_play",
			product: "modbus-poll",
			external_id: "g1",
			source: "manual-import",
		});
		expect(stored(t, "g1")).toEqual({
			rail: "google_play",
			product: "modbus-poll",
			revenue: 10,
			net_revenue: 7.9,
			net_source: "reported",
		});
		expect(
			(await post(t, writer, { revenue: 10, net_revenue: 11, external_id: "g2" })).status,
		).toBe(400);
		expect(
			(await post(t, writer, { revenue: 10, rail: "no good", external_id: "g3" })).status,
		).toBe(400);
	});

	it("uses the owner's saved fee rule", async () => {
		const { t, session, writer } = await setup();
		const put = await t.call("PUT", "/api/fee-rules", {
			token: session,
			body: { rules: [{ rail: "apple", percent_bps: 3000 }] },
		});
		expect(put.status).toBe(200);
		const rules: { data: { rail: string; percent_bps: number; is_default: boolean }[] } =
			await put.json();
		expect(rules.data.find((r) => r.rail === "apple")).toMatchObject({
			percent_bps: 3000,
			is_default: false,
		});
		expect(rules.data.find((r) => r.rail === "polar")?.is_default).toBe(true);

		await post(t, writer, { revenue: 10, external_id: "a2", source: "app_store" });
		expect(stored(t, "a2")).toMatchObject({ net_revenue: 7, net_source: "rule" });
	});
});

interface PortfolioBody {
	data: {
		currency: string;
		totals: {
			gross: number;
			net: number;
			sales: number;
			refunds: number;
			refund_amount: number;
		};
		by_rail: { rail: string; gross: number; net: number }[];
		by_product: { product: string | null; gross: number }[];
		daily: unknown[];
		recent: { converted_net: number }[];
	};
}

describe("GET portfolio revenue", () => {
	it("totals sales and refunds across rails for both surfaces", async () => {
		const { t, session, writer, reader } = await setup();
		await post(t, writer, {
			revenue: 10,
			external_id: "a1",
			source: "app_store",
			product: "joyorogo",
		});
		await post(t, writer, {
			name: "refund",
			revenue: -4,
			external_id: "a1:refund",
			source: "app_store",
		});
		await post(t, writer, { revenue: 20, external_id: "s1", source: "stripe" });

		const check = (body: PortfolioBody) => {
			expect(body.data.currency).toBe("USD");
			expect(body.data.totals.gross).toBeCloseTo(26);
			expect(body.data.totals.net).toBeCloseTo(8.5 - 3.4 + 19.12);
			expect(body.data.totals).toMatchObject({ sales: 2, refunds: 1 });
			expect(body.data.totals.refund_amount).toBeCloseTo(4);
			expect(body.data.by_rail.map((r) => r.rail).sort()).toEqual(["apple", "stripe"]);
			expect(body.data.by_product.some((p) => p.product === "joyorogo")).toBe(true);
			expect(body.data.daily).toHaveLength(1);
			expect(body.data.recent).toHaveLength(3);
		};

		const pub = await t.call("GET", "/api/v1/portfolio/revenue", { token: reader });
		expect(pub.status).toBe(200);
		check(await pub.json());
		const dash = await t.call("GET", "/api/portfolio/revenue", { token: session });
		expect(dash.status).toBe(200);
		check(await dash.json());
	});

	it("needs analytics:read and a valid range", async () => {
		const { t, writer, reader } = await setup();
		expect((await t.call("GET", "/api/v1/portfolio/revenue", { token: writer })).status).toBe(403);
		expect(
			(await t.call("GET", "/api/v1/portfolio/revenue?from=nope", { token: reader })).status,
		).toBe(400);
	});

	it("excludes bot rows and treats legacy rows without net as net = gross", async () => {
		const { t, reader } = await setup();
		const now = new Date().toISOString();
		const insert = t.db.prepare(
			"INSERT INTO events (id, site_id, session_id, visitor_id, timestamp, event_type, name, path, revenue, currency, is_bot) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
		);
		insert.run("e1", "s-pf", "x", "v", now, "conversion", "purchase", "/", 5, "USD", 0);
		insert.run("e2", "s-pf", "x", "v", now, "conversion", "purchase", "/", 99, "USD", 1);
		const res = await t.call("GET", "/api/v1/portfolio/revenue", { token: reader });
		const body: PortfolioBody = await res.json();
		expect(body.data.totals).toMatchObject({ gross: 5, net: 5, sales: 1 });
	});
});
