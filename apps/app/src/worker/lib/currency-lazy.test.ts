import { describe, expect, it } from "bun:test";
import { createDb } from "../db";
import { ensureSiteCurrency } from "./currency-backfill";
import { createMigratedTestApp } from "./test-harness";

describe("lazy currency inference (DEV-33)", () => {
	it("an uninferred IDR site is settled on its first dashboard read", async () => {
		const t = await createMigratedTestApp();
		const token = await t.seedUser({ id: "u-lazy", plan: "growth", withSite: "s-lazy" });
		const add = (amount: number, currency: string) =>
			t.db
				.prepare(
					"INSERT INTO events (id, site_id, session_id, visitor_id, timestamp, path, revenue, currency) VALUES (?,?,?,?,?,?,?,?)",
				)
				.run(
					crypto.randomUUID(),
					"s-lazy",
					"s",
					"v",
					new Date().toISOString(),
					"/",
					amount,
					currency,
				);
		add(50_000, "IDR");
		add(150_000, "IDR");
		add(1, "USD");

		const res = await t.call("GET", "/api/analytics/dashboard?site_id=s-lazy&range=7d", { token });
		const body = (await res.json()) as { currency: string; data: { stats: { revenue: number } } };
		expect(body.currency).toBe("IDR");
		expect(body.data.stats.revenue).toBeCloseTo(216_000);
		expect(
			t.db
				.query(
					"SELECT revenue_currency AS c, revenue_currency_source AS s FROM sites WHERE id = 's-lazy'",
				)
				.get(),
		).toEqual({ c: "IDR", s: "auto" });
	});

	it("runs once per isolate and fails open", async () => {
		const t = await createMigratedTestApp();
		await t.seedUser({ id: "u-lazy2", withSite: "s-lazy2" });
		const db = createDb(t.d1);
		expect(await ensureSiteCurrency(db, "s-lazy2", "USD", null)).toBe("USD");
		t.db.exec("UPDATE sites SET revenue_currency_source = NULL WHERE id = 's-lazy2'");
		await ensureSiteCurrency(db, "s-lazy2", "USD", null);
		const src = t.db
			.query("SELECT revenue_currency_source AS s FROM sites WHERE id = 's-lazy2'")
			.get();
		expect(src).toEqual({ s: null });

		const broken = createDb({
			prepare: () => {
				throw new Error("D1 down");
			},
		} as unknown as D1Database);
		expect(await ensureSiteCurrency(broken, "s-broken", "SGD", null)).toBe("SGD");
	});
});
