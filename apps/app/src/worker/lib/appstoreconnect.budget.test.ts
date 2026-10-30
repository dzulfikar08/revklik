import { afterEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { createDb } from "../db";
import { migrateDatabase } from "../migrations";
import {
	ascDayComplete,
	ascWindowDays,
	syncAllAppStoreConnect,
	syncAppStoreConnect,
	type FetchBudget,
} from "./appstoreconnect";
import { makeD1 } from "./test-harness";
import { generatePkcs8Pem } from "./test-keys";

const APP_ID = "123456789";
const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

const isoDaysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

const HEADER =
	"Provider\tProvider Country\tSKU\tDesignated SKU Supported\tDeveloper Proceeds\tBegin Date\tEnd Date\tCustomer Currency\tCountry Code\tCurrency of Proceeds\tUnits\tDeveloper Proceeds Extended\tCustomer Price\tProduct Type Identifier\tApple Identifier\tVendor Identifier";

/** Apple's sales-report endpoint: `statusFor(date)` decides each day's answer; every sales fetch is logged. */
function mockApple(statusFor: (date: string) => number = () => 200) {
	const requestedDates: string[] = [];
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		const url = String(input);
		const date = /filter\[reportDate\]=([\d-]+)/.exec(url)?.[1];
		if (date) {
			requestedDates.push(date);
			const status = statusFor(date);
			return new Response(status === 200 ? HEADER : "no report", { status });
		}
		// Engagement endpoints: nothing to add for these tests.
		return new Response("not found", { status: 404 });
	}) as typeof fetch;
	return requestedDates;
}

async function setup(integrations = 1) {
	const db = new Database(":memory:");
	const d1 = makeD1(db);
	await migrateDatabase(d1 as unknown as D1Database);
	const keys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
		"sign",
		"verify",
	])) as CryptoKeyPair;
	const config = JSON.stringify({
		issuer_id: "iss",
		key_id: "kid",
		private_key: await generatePkcs8Pem(keys.privateKey),
		vendor_number: "123",
		app_id: APP_ID,
	});
	const now = new Date().toISOString();
	for (let i = 1; i <= integrations; i++) {
		db.prepare("INSERT INTO sites (id, user_id, name, domain, created_at) VALUES (?,?,?,?,?)").run(
			`s${i}`,
			"u1",
			`Site ${i}`,
			`s${i}.example.com`,
			now,
		);
		db.prepare(
			"INSERT INTO integrations (id, site_id, user_id, type, name, config, enabled, created_at) VALUES (?,?,?,?,?,?,1,?)",
		).run(`i${i}`, `s${i}`, "u1", "appstoreconnect", "ASC", config, now);
	}
	const kysely = createDb(d1 as unknown as D1Database);
	const integration = (id: string) =>
		kysely
			.selectFrom("integrations")
			.select(["id", "site_id", "user_id", "config", "last_sync", "synced_through"])
			.where("id", "=", id)
			.executeTakeFirstOrThrow();
	const cursor = (id: string) =>
		db.query("SELECT synced_through, last_sync FROM integrations WHERE id = ?").get(id) as {
			synced_through: string | null;
			last_sync: string | null;
		};
	return { db, kysely, integration, cursor };
}

describe("App Store sync: days cut off by the fetch budget are not marked synced", () => {
	it("advances the cursor only over fetched days and resumes where the budget ended", async () => {
		const { kysely, integration, cursor } = await setup();
		const requested = mockApple();
		const first: FetchBudget = { n: 0, max: 5 };

		const run1 = await syncAppStoreConnect(kysely, await integration("i1"), {
			days: 10,
			budget: first,
		});

		expect(run1.budget_exhausted).toBe(true);
		expect(run1.days_synced).toBe(5);
		// Oldest days first: the cursor sits on the 5th oldest day, nothing newer is claimed.
		expect(requested).toEqual([9, 8, 7, 6, 5].map(isoDaysAgo));
		expect(cursor("i1").synced_through).toBe(isoDaysAgo(5));

		requested.length = 0;
		const run2 = await syncAppStoreConnect(kysely, await integration("i1"), {
			budget: { n: 0, max: 45 },
		});

		expect(run2.budget_exhausted).toBe(false);
		// Window from the cursor: the 7-day steady lookback already covers days 6..0.
		expect(requested[0]).toBe(isoDaysAgo(6));
		expect(requested).toContain(isoDaysAgo(2));
		// Every day answered 200, so the cursor reaches today.
		expect(cursor("i1").synced_through).toBe(isoDaysAgo(0));
	});

	it("a day still 404 at Apple (today and yesterday) is asked again, not skipped past", async () => {
		const { kysely, integration, cursor } = await setup();
		mockApple((date) => (date >= isoDaysAgo(1) ? 404 : 200));

		await syncAppStoreConnect(kysely, await integration("i1"), {
			days: 7,
			budget: { n: 0, max: 45 },
		});

		expect(cursor("i1").synced_through).toBe(isoDaysAgo(2));
	});

	it("an Apple outage on one day holds the cursor there while later days are still fetched", async () => {
		const { kysely, integration, cursor } = await setup();
		const requested = mockApple((date) => (date === isoDaysAgo(4) ? 503 : 200));

		const run = await syncAppStoreConnect(kysely, await integration("i1"), {
			days: 7,
			budget: { n: 0, max: 45 },
		});

		expect(cursor("i1").synced_through).toBe(isoDaysAgo(5));
		expect(requested).toContain(isoDaysAgo(0));
		expect(run.days_synced).toBe(6);
		expect(run.days_skipped).toBe(1);
	});

	it("a run that fetched nothing does not look like a sync and keeps the old cursor", async () => {
		const { kysely, integration, cursor, db } = await setup();
		db.prepare("UPDATE integrations SET synced_through = ? WHERE id = 'i1'").run(isoDaysAgo(3));
		mockApple();

		const run = await syncAppStoreConnect(kysely, await integration("i1"), {
			budget: { n: 45, max: 45 },
		});

		expect(run.budget_exhausted).toBe(true);
		expect(run.days_synced + run.days_skipped).toBe(0);
		expect(cursor("i1")).toEqual({ synced_through: isoDaysAgo(3), last_sync: null });
	});

	it("the nightly run serves the longest-waiting integration first and never starves the others", async () => {
		const { db, kysely } = await setup(3);
		db.prepare("UPDATE integrations SET last_sync = ? WHERE id = 'i1'").run("2026-10-29T18:00:00Z");
		db.prepare("UPDATE integrations SET last_sync = ? WHERE id = 'i2'").run("2026-10-20T18:00:00Z");
		// i3 never synced: first in line.
		const sites: string[] = [];
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			sites.push(String(input));
			return new Response("no report", { status: 404 });
		}) as typeof fetch;

		await syncAllAppStoreConnect(kysely);

		// 45-fetch shared budget: i3 (30-day backfill) goes first and i2 follows; i1, synced
		// most recently, is the one left for the next run.
		const spent = db.query("SELECT id, last_sync FROM integrations ORDER BY id").all() as {
			id: string;
			last_sync: string | null;
		}[];
		expect(spent.find((r) => r.id === "i3")?.last_sync).not.toBeNull();
		expect(spent.find((r) => r.id === "i1")?.last_sync).toBe("2026-10-29T18:00:00Z");
		expect(sites.length).toBeLessThanOrEqual(45 + 5);
	});
});

describe("ascWindowDays", () => {
	const today = "2026-10-30";
	it("backfills on a first sync, re-reads a week in steady state, catches up after an outage", () => {
		expect(ascWindowDays({ syncedThrough: null, today })).toBe(30);
		expect(ascWindowDays({ syncedThrough: null, backfillDays: "60", today })).toBe(60);
		expect(ascWindowDays({ syncedThrough: "2026-10-29", today })).toBe(7);
		expect(ascWindowDays({ syncedThrough: "2026-10-10", today })).toBe(20);
		expect(ascWindowDays({ syncedThrough: "2025-01-01", today })).toBe(90);
		expect(ascWindowDays({ days: 3, syncedThrough: "2026-10-10", today })).toBe(3);
	});
});

describe("ascDayComplete", () => {
	it("treats reports, old 404s and permanent 4xx as settled; fresh 404s, 429 and 5xx as retry", () => {
		expect(ascDayComplete(200, 0)).toBe(true);
		expect(ascDayComplete(404, 5)).toBe(true);
		expect(ascDayComplete(404, 1)).toBe(false);
		expect(ascDayComplete(404, 0)).toBe(false);
		expect(ascDayComplete(429, 5)).toBe(false);
		expect(ascDayComplete(503, 5)).toBe(false);
		expect(ascDayComplete(400, 5)).toBe(true);
	});
});
