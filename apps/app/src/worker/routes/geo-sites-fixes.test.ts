import { describe, expect, it } from "bun:test";
import { clearStoredRatesCache } from "../lib/fx";
import { createMigratedTestApp } from "../lib/test-harness";

describe("/api/analytics/geo", () => {
	it("counts a visitor once when a server purchase shares their id", async () => {
		const t = await createMigratedTestApp();
		const token = await t.seedUser({ id: "u-geo", plan: "growth", withSite: "s-geo" });
		const now = new Date().toISOString();
		const insert = t.db.prepare(
			"INSERT INTO events (id, site_id, session_id, visitor_id, timestamp, event_type, path, country, external_id) VALUES (?,?,?,?,?,?,?,?,?)",
		);
		insert.run("pv", "s-geo", "ses", "vis", now, "pageview", "/", "ID", null);
		insert.run("pu", "s-geo", "ses", "vis", now, "conversion", "/", null, "order-1");

		const res = await t.call("GET", "/api/analytics/geo?site_id=s-geo&range=7d", { token });
		expect(res.status).toBe(200);
		const body: { data: { country: string | null; visitors: number }[] } = await res.json();
		expect(body.data).toEqual([expect.objectContaining({ country: "ID", visitors: 1 })]);
	});
});

describe("GET /api/sites revenue", () => {
	it("converts with stored fx_rates, not the static table", async () => {
		clearStoredRatesCache();
		const t = await createMigratedTestApp();
		const token = await t.seedUser({ id: "u-fx", plan: "growth", withSite: "s-fx" });
		t.db
			.prepare(
				"INSERT OR REPLACE INTO fx_rates (currency, per_usd, as_of) VALUES ('IDR', 10000, '2026-01-01')",
			)
			.run();
		t.db
			.prepare(
				"INSERT INTO events (id, site_id, session_id, visitor_id, timestamp, path, revenue, currency) VALUES ('e','s-fx','s','v',?,'/',20000,'IDR')",
			)
			.run(new Date().toISOString());

		const res = await t.call("GET", "/api/sites", { token });
		const body: { data: { id: string; currency: string; revenue: number }[] } = await res.json();
		const site = body.data.find((s) => s.id === "s-fx");
		expect(site?.currency).toBe("USD");
		expect(site?.revenue).toBeCloseTo(2, 5);
		clearStoredRatesCache();
	});
});
