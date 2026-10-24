import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { createDb } from "../db";
import { migrateDatabase } from "../migrations";
import { clearStoredRatesCache, loadUsdRates, refreshFxRates } from "./fx";
import { makeD1 } from "./test-harness";

async function freshDb() {
	const db = new Database(":memory:");
	const d1 = makeD1(db) as unknown as D1Database;
	await migrateDatabase(d1);
	return createDb(d1);
}

const feed = (rates: Record<string, number>): typeof fetch =>
	(async () =>
		new Response(JSON.stringify({ date: "2026-10-23", rates }), { status: 200 })) as never;

beforeEach(() => clearStoredRatesCache());
afterEach(() => clearStoredRatesCache());

describe("FX rates", () => {
	it("covers the currencies the App Store prices in without a stored table", async () => {
		const rates = await loadUsdRates(await freshDb());
		for (const code of ["JPY", "THB", "SEK", "MXN", "PLN", "CHF", "GBP", "IDR"]) {
			expect(rates[code]).toBeGreaterThan(0);
		}
		expect(rates.JPY).toBeGreaterThan(rates.EUR ?? 0);
	});

	it("overlays the daily refresh on the fallback, and FX_USD_IDR still wins for IDR", async () => {
		const db = await freshDb();
		expect(await refreshFxRates(db, feed({ JPY: 160, IDR: 15_500, bad: -1 }))).toBe(2);
		const rates = await loadUsdRates(db);
		expect(rates.JPY).toBe(160);
		expect(rates.IDR).toBe(15_500);
		expect(rates.THB).toBeGreaterThan(0);
		clearStoredRatesCache();
		expect((await loadUsdRates(db, { FX_USD_IDR: "17000" })).IDR).toBe(17_000);
	});

	it("keeps the stored rates when the feed fails", async () => {
		const db = await freshDb();
		await refreshFxRates(db, feed({ JPY: 155 }));
		const failing = (async () => new Response("down", { status: 503 })) as never;
		await expect(refreshFxRates(db, failing)).rejects.toThrow("HTTP 503");
		clearStoredRatesCache();
		expect((await loadUsdRates(db)).JPY).toBe(155);
	});
});
